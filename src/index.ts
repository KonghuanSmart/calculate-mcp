#!/usr/bin/env node
/**
 * Calculate MCP Server
 *
 * 提供数学计算、进转换、位运算、编解码等工具。
 * 单次工具与 batch_calc 均由 ops 注册表生成；
 * batch_calc 可一次执行多个计算，并支持步骤间引用上一步结果。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ops, opNames } from "./ops.js";

const BATCH_HINT = "For several operations or chained steps in one call, use batch_calc.";

/** 结构化引用：{"$step": 0} 取整步结果；{"$step": 0, "field": "resultHex"} 取其中某字段 */
interface StepRef {
    $step: number;
    field?: string;
}

type StepOutcome =
    | { step: number; op: string; status: "ok"; result: unknown }
    | { step: number; op: string; status: "error"; error: string }
    | { step: number; op: string; status: "skipped"; reason: string };

function isRef(value: unknown): value is StepRef {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "$step" in value;
}

/** 采集参数中引用到的步骤下标，并校验引用只能指向更早且存在的步骤 */
function collectDeps(value: unknown, currentStep: number, deps: Set<number>): void {
    if (isRef(value)) {
        const target = value.$step;
        if (!Number.isInteger(target) || target < 0 || target >= currentStep) {
            throw new Error(currentStep === 0
                ? `Step 0: "$step" cannot be used because there is no earlier step to reference, got ${target}`
                : `Step ${currentStep}: "$step" must reference an earlier step (0 to ${currentStep - 1}), got ${target}`);
        }
        deps.add(target);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(item => collectDeps(item, currentStep, deps));
        return;
    }
    if (value !== null && typeof value === "object") {
        Object.values(value).forEach(item => collectDeps(item, currentStep, deps));
    }
}

/** 把参数中的引用替换为对应步骤的结果 */
function resolveRefs(value: unknown, outcomes: StepOutcome[]): unknown {
    if (isRef(value)) {
        const result = (outcomes[value.$step] as { result: unknown }).result;
        if (value.field === undefined) {
            return result;
        }
        if (result === null || typeof result !== "object" || !(value.field in result)) {
            throw new Error(`Step ${value.$step} result has no field "${value.field}"`);
        }
        return (result as Record<string, unknown>)[value.field];
    }
    if (Array.isArray(value)) {
        return value.map(item => resolveRefs(item, outcomes));
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, outcomes)]));
    }
    return value;
}

/** zod 校验错误压成一行，避免把一整坨 JSON 塞进批量结果 */
function formatError(error: unknown): string {
    if (error instanceof z.ZodError) {
        return error.issues.map(issue => `${issue.path.join('.') || 'args'}: ${issue.message}`).join('; ');
    }
    return error instanceof Error ? error.message : String(error);
}

const BATCH_DESCRIPTION = `Executes multiple calculation steps in one call and returns all results at once.

Steps run sequentially in array order. Each step is {"op": "<tool name>", "args": {...}}, where "op" is any of: ${opNames.join(", ")}.

Chaining: an argument value may be a reference to an earlier step's result:
  {"$step": <index>}                     -> the whole result of that step
  {"$step": <index>, "field": "<name>"}  -> a specific field of that step's object result (required when the result is an object, e.g. "resultHex", "decimal", "hex", "base64")

References only point to earlier steps (index < current). Returns a compact JSON array in step order, each item {step, op, status, result|error|reason}. A step is "skipped" only if a step it depends on failed; unrelated steps still run.`;

const stepSchema = z.object({
    op: z.enum(opNames).describe("Operation name (identical to the corresponding single tool name)"),
    args: z.record(z.any()).optional().describe(`Arguments for the operation, same as the single tool's parameters. Values may be references: {"$step": 0} or {"$step": 0, "field": "resultHex"}`)
});

export default function createServer() {
    const calcServer = new McpServer({
        name: "calculate-mcp",
        version: "0.1.0"
    })

    for (const [name, def] of Object.entries(ops)) {
        calcServer.tool(name, `${def.description}. ${BATCH_HINT}`, def.shape, async (args) => {
            const value = def.run(args)

            return {
                content: [{
                    type: "text",
                    text: def.format(value)
                }]
            }
        })
    }

    calcServer.tool("batch_calc", BATCH_DESCRIPTION, {
        steps: z.array(stepSchema).min(1).describe("Ordered calculation steps; later steps may reference earlier results")
    }, async ({ steps }) => {
        // 先整体校验引用合法性：结构错误直接抛出，不做逐条吞掉
        const deps = steps.map((step, index) => {
            const set = new Set<number>()
            collectDeps(step.args ?? {}, index, set)
            return set
        })

        const outcomes: StepOutcome[] = []
        steps.forEach((step, index) => {
            const failedDep = [...deps[index]].find(dep => outcomes[dep].status !== "ok")
            if (failedDep !== undefined) {
                outcomes.push({
                    step: index,
                    op: step.op,
                    status: "skipped",
                    reason: `depends on step ${failedDep} which is ${outcomes[failedDep].status}`
                })
                return
            }

            try {
                const def = ops[step.op]
                const args = z.object(def.shape).parse(resolveRefs(step.args ?? {}, outcomes))
                outcomes.push({ step: index, op: step.op, status: "ok", result: def.run(args) })
            } catch (error) {
                outcomes.push({
                    step: index,
                    op: step.op,
                    status: "error",
                    error: formatError(error)
                })
            }
        })

        return {
            content: [{
                type: "text",
                text: JSON.stringify(outcomes)
            }]
        }
    })

    return calcServer.server
}

async function main() {
    const server = createServer();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server running in stdio mode");
}

// By default run the server with stdio transport
main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
