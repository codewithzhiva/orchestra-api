import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { config } from "../config.js";
import { emitRunEvent } from "../lib/events.js";
import { HttpNodeConfig, runHttpNode } from "./nodes/http.js";
import { CodeNodeConfig, runCodeNode } from "./nodes/code.js";

const LlmNodeSpec = z.object({
  id: z.string(),
  type: z.literal("llm"),
  model: z.string().optional(),
  system: z.string().optional(),
  prompt: z.string(),
});

const HttpNodeSpec = z.object({
  id: z.string(),
  type: z.literal("http"),
  url: z.string(),
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
  headers: z.record(z.string()).optional(),
  bodyTemplate: z.string().optional(),
  timeoutMs: z.number().default(10_000),
  // output label injected into state.outputs[id]
});

const CodeNodeSpec = z.object({
  id: z.string(),
  type: z.literal("code"),
  code: z.string(),
  timeoutMs: z.number().default(2_000),
});

export const NodeSpec = z.discriminatedUnion("type", [
  LlmNodeSpec,
  HttpNodeSpec,
  CodeNodeSpec,
]);

export const EdgeSpec = z.object({
  from: z.string(),
  to: z.string(),
});

export const GraphSpec = z.object({
  name: z.string(),
  nodes: z.array(NodeSpec).min(1),
  edges: z.array(EdgeSpec),
  entry: z.string(),
});

export type GraphSpecT = z.infer<typeof GraphSpec>;

const State = Annotation.Root({
  input: Annotation<string>(),
  outputs: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  last: Annotation<string>({ reducer: (_, b) => b, default: () => "" }),
});

function render(template: string, ctx: { input: string; outputs: Record<string, string> }) {
  return template
    .replace(/\{\{input\}\}/g, ctx.input)
    .replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, k) => ctx.outputs[k] ?? "");
}

export function buildGraph(spec: GraphSpecT, runId: string) {
  const g = new StateGraph(State);

  for (const node of spec.nodes) {
    g.addNode(node.id, async (state) => {
      emitRunEvent({ type: "node.started", runId, node: node.id });
      let text: string;

      if (node.type === "llm") {
        const llm = new ChatOllama({
          baseUrl: config.OLLAMA_BASE_URL,
          model: node.model ?? config.OLLAMA_DEFAULT_MODEL,
        });
        const prompt = render(node.prompt, { input: state.input, outputs: state.outputs });
        const messages = [
          ...(node.system ? [{ role: "system" as const, content: node.system }] : []),
          { role: "user" as const, content: prompt },
        ];
        const res = await llm.invoke(messages);
        text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);

      } else if (node.type === "http") {
        const cfg = HttpNodeConfig.parse(node);
        const renderedUrl = render(node.url, { input: state.input, outputs: state.outputs });
        const renderedBody = node.bodyTemplate
          ? render(node.bodyTemplate, { input: state.input, outputs: state.outputs })
          : undefined;
        text = await runHttpNode(cfg, { url: renderedUrl, body: renderedBody });

      } else {
        // code node
        text = runCodeNode(CodeNodeConfig.parse(node), {
          input: state.input,
          outputs: state.outputs,
        });
      }

      emitRunEvent({ type: "node.finished", runId, node: node.id, output: text });
      return { outputs: { [node.id]: text }, last: text };
    });
  }

  const hasOutgoing = new Set(spec.edges.map((e) => e.from));
  for (const node of spec.nodes) {
    if (!hasOutgoing.has(node.id)) {
      g.addEdge(node.id as never, END);
    }
  }
  g.addEdge(START, spec.entry as never);
  for (const edge of spec.edges) {
    g.addEdge(edge.from as never, edge.to as never);
  }

  return g.compile();
}
