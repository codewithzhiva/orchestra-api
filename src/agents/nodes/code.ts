import vm from "node:vm";
import { z } from "zod";

export const CodeNodeConfig = z.object({
  // JS code. Has access to: input (string), outputs (Record<string,string>)
  // Must assign result to the `result` variable.
  // Example: const data = JSON.parse(outputs.fetch_step); result = data.items.join(', ');
  code: z.string(),
  timeoutMs: z.number().min(10).max(5_000).default(2_000),
});

export type CodeNodeConfigT = z.infer<typeof CodeNodeConfig>;

export function runCodeNode(
  config: CodeNodeConfigT,
  context: { input: string; outputs: Record<string, string> },
): string {
  // Sandbox: only expose input/outputs + basic JS globals. No require/process/fs.
  const sandbox = {
    input: context.input,
    outputs: context.outputs,
    JSON,
    Math,
    String,
    Number,
    Array,
    Object,
    result: undefined as unknown,
  };

  const script = new vm.Script(config.code);
  const ctx = vm.createContext(sandbox);
  script.runInContext(ctx, { timeout: config.timeoutMs });

  if (sandbox.result === undefined) {
    throw new Error("Code node must assign a value to `result`");
  }

  return typeof sandbox.result === "string"
    ? sandbox.result
    : JSON.stringify(sandbox.result);
}
