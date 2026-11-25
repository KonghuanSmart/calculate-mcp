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
const CAST_KINDS = ["number", "bigint", "string"] as const;
type CastKind = (typeof CAST_KINDS)[number];

interface StepRef {
    $step: number;
    field?: string;
    $cast?: CastKind;
}

type StepOutcome =
    | { step: number; op: string; status: "ok"; result: unknown }
    | { step: number; op: string; status: "error"; error: string }
    | { step: number; op: string; status: "skipped"; reason: string };

function isRef(value: unknown): value is StepRef {
    return typeof value === "object" && value !== null && !Array.isArray(value) && "$step" in value;
}

const INTEGER_PATTERN = /^([+-]?)(0[xX][0-9a-fA-F]+|\d+)$/;
const NUMERIC_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseCast(value: unknown): CastKind {
    const raw = typeof value === "string" ? value : String(value);
    const normalized = raw.trim().toLowerCase().replace(/[\s_-]/g, "");
    const match = CAST_KINDS.find(kind => kind === normalized);
    if (match === undefined) {
        throw new Error(`Unknown $cast "${raw}"; expected one of: ${CAST_KINDS.join(", ")}`);
    }
    return match;
}

function applyCast(value: unknown, cast: CastKind): unknown {
    switch (cast) {
        case "number": {
            const text = typeof value === "number" ? undefined : String(value).trim();
            if (text === "") {
                throw new Error("Cannot cast an empty string to number: the referenced value is empty and cannot be used as a number");
            }
            const numeric = typeof value === "number" ? value : Number(text);
            if (!Number.isFinite(numeric)) {
                throw new Error(`Cannot cast ${JSON.stringify(value)} to number`);
            }
            return numeric;
        }
        case "bigint": {
            if (typeof value === "number") {
                if (!Number.isInteger(value)) {
                    throw new Error(`Cannot cast ${value} to bigint: not an integer`);
                }
                return BigInt(value).toString();
            }
            const text = String(value).trim();
            const match = INTEGER_PATTERN.exec(text);
            if (match === null) {
                throw new Error(`Cannot cast "${text}" to bigint: expected an integer (decimal or 0x hex)`);
            }
            const magnitude = BigInt(match[2]);
            return (match[1] === "-" ? -magnitude : magnitude).toString();
        }
        case "string":
            return typeof value === "string" ? value : JSON.stringify(value);
    }
}

function unwrapSchema(schema: any): any {
    let current = schema;
    while (current !== undefined && current !== null && current._def !== undefined) {
        const type = current._def.typeName;
        if (type === "ZodOptional" || type === "ZodNullable" || type === "ZodDefault" || type === "ZodReadonly") {
            current = current._def.innerType;
        } else if (type === "ZodEffects") {
            current = current._def.schema;
        } else {
            break;
        }
    }
    return current;
}

function acceptsType(schema: any, typeName: string): boolean {
    const inner = unwrapSchema(schema);
    if (inner === undefined || inner === null || inner._def === undefined) {
        return false;
    }
    if (inner._def.typeName === "ZodUnion") {
        return inner._def.options.some((option: any) => acceptsType(option, typeName));
    }
    return inner._def.typeName === typeName;
}

function coerceValue(value: unknown, schema: any): unknown {
    const inner = unwrapSchema(schema);
    if (inner === undefined || inner === null || inner._def === undefined) {
        return value;
    }
    if (inner._def.typeName === "ZodArray") {
        return Array.isArray(value) ? value.map(item => coerceValue(item, inner._def.type)) : value;
    }
    if (typeof value === "string") {
        const text = value.trim();
        if (NUMERIC_PATTERN.test(text) && Number.isFinite(Number(text))
            && acceptsType(inner, "ZodNumber") && !acceptsType(inner, "ZodString")) {
            return Number(text);
        }
    }
    return value;
}

function coerceArguments(args: Record<string, unknown>, shape: z.ZodRawShape): Record<string, unknown> {
    const coerced: Record<string, unknown> = { ...args };
    for (const [key, schema] of Object.entries(shape)) {
        if (key in coerced) {
            coerced[key] = coerceValue(coerced[key], schema);
        }
    }
    return coerced;
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
        let resolved = result;
        if (value.field !== undefined) {
            if (result === null || typeof result !== "object" || !(value.field in result)) {
                throw new Error(`Step ${value.$step} result has no field "${value.field}"`);
            }
            resolved = (result as Record<string, unknown>)[value.field];
        }
        return value.$cast === undefined ? resolved : applyCast(resolved, parseCast(value.$cast));
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
  {"$step": <index>, "field": "<name>"}  -> a specific field of that step's object result (required when the result is an object: division returns {"value", "quotient", "remainder"}, so use {"$step": 0, "field": "value"} to get the number; other fields include "resultHex", "decimal", "hex", "base64")
  {"$cast": "number" | "bigint" | "string", "$step": <index>, "field": "<name>"} -> the referenced value converted to another type

Casting: "$cast" accepts "number" (numeric conversion), "bigint" (exact integer as a decimal string, e.g. "0x401000" -> "4198400"), or "string" (non-strings serialized as JSON). Names are case-insensitive and "_"/"-" are interchangeable ("Number" and "big_int" also work); unknown names return an error listing the accepted kinds.

Automatic coercion: a numeric string is converted to a number only when the target parameter accepts numbers and not strings (e.g. int_convert's "decimal" can feed add directly). Parameters declared as number | string (add, sum, floor, round, min, mode, ...) receive the string unchanged, so big integers stay exact; for exact big integers either rely on those parameters or use "$cast": "bigint" to hand an exact decimal string.

References only point to earlier steps (index < current). Returns a compact JSON array in step order, each item {step, op, status, result|error|reason}. A step is "skipped" only if a step it depends on failed; unrelated steps still run.`;

const stepSchema = z.object({
    op: z.enum(opNames).describe("Operation name (identical to the corresponding single tool name)"),
    args: z.record(z.any()).optional().describe(`Arguments for the operation, same as the single tool's parameters. Values may be references: {"$step": 0} or {"$step": 0, "field": "resultHex"}`)
});

export default function createServer() {
    const calcServer = new McpServer({
        name: "calculate-mcp",
        version: "0.1.3"
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
                const resolved = resolveRefs(step.args ?? {}, outcomes) as Record<string, unknown>
                const args = z.object(def.shape).parse(coerceArguments(resolved, def.shape))
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
