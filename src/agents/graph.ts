import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { config } from "../config.js";
import { emitRunEvent } from "../lib/events.js";

export const NodeSpec = z.object({
  id: z.string(),
  type: z.enum(["llm"]),
  model: z.string().optional(),
  system: z.string().optional(),
  prompt: z.string(),
});

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
      const llm = new ChatOllama({
        baseUrl: config.OLLAMA_BASE_URL,
        model: node.model ?? config.OLLAMA_DEFAULT_MODEL,
      });
      const prompt = render(node.prompt, {
        input: state.input,
        outputs: state.outputs,
      });
      const messages = [
        ...(node.system ? [{ role: "system" as const, content: node.system }] : []),
        { role: "user" as const, content: prompt },
      ];
      const res = await llm.invoke(messages);
      const text = typeof res.content === "string"
        ? res.content
        : JSON.stringify(res.content);
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
