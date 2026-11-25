export type NumericInput = number | string;
export const ROUND_MODES = ["js-round", "half-up", "half-even", "truncate"] as const;
export type RoundMode = (typeof ROUND_MODES)[number];

export type NumericValue =
    | { kind: "integer"; value: bigint }
    | { kind: "float"; value: number };

const DECIMAL_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
const HEX_PATTERN = /^([+-]?)0[xX]([0-9a-fA-F]+)$/;
const INTEGER_PATTERN = /^([+-]?)(\d+)$/;

function invalidNumericText(text: string): Error {
    return new Error(
        `Invalid numeric input: "${text}" (expected a decimal, 0x hex integer, fraction a/b, or signed value)`
    );
}

function finiteDouble(value: number, text: string): number {
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid numeric input: "${text}" (outside the finite double range)`);
    }
    return value;
}

function floatText(value: number): string {
    if (!Number.isFinite(value)) {
        throw new Error(`Result ${value} is outside the finite double range`);
    }
    return String(value);
}

function unsafeIntegerText(input: number): string {
    return `Unsafe integer input: ${input} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}) and may already be rounded`;
}

function looksLikeExponent(input: number): boolean {
    return /[eE]/.test(String(input));
}

export function assertExactNumber(input: number): void {
    if (!Number.isFinite(input)) {
        throw new Error(`Invalid numeric input: ${input}`);
    }
    if (Number.isInteger(input) && !Number.isSafeInteger(input) && !looksLikeExponent(input)) {
        throw new Error(
            `${unsafeIntegerText(input)}; pass the intended value as a string (e.g. "9007199254740993")`
        );
    }
}

function toDouble(value: NumericValue): number {
    return value.kind === "integer" ? Number(value.value) : value.value;
}

function parseScalarText(text: string, displayText: string): NumericValue {
    const hex = HEX_PATTERN.exec(text);
    if (hex !== null) {
        const magnitude = BigInt("0x" + hex[2]);
        return { kind: "integer", value: hex[1] === "-" ? -magnitude : magnitude };
    }
    const integer = INTEGER_PATTERN.exec(text);
    if (integer !== null) {
        const magnitude = BigInt(integer[2]);
        return { kind: "integer", value: integer[1] === "-" ? -magnitude : magnitude };
    }
    const match = DECIMAL_PATTERN.exec(text);
    if (match === null || (match[2] === "" && (match[3] ?? "") === "")) {
        throw invalidNumericText(displayText);
    }
    return { kind: "float", value: finiteDouble(Number(text), displayText) };
}

export function parseNumeric(input: NumericInput): NumericValue {
    if (typeof input === "number") {
        assertExactNumber(input);
        return Number.isInteger(input) && !looksLikeExponent(input)
            ? { kind: "integer", value: BigInt(input) }
            : { kind: "float", value: input };
    }
    const text = input.trim();
    if (text === "") {
        throw new Error("Numeric input cannot be empty");
    }
    const parts = text.split("/");
    if (parts.length === 1) {
        return parseScalarText(text, text);
    }
    if (parts.length > 2) {
        throw invalidNumericText(text);
    }
    const numeratorText = parts[0].trim();
    const denominatorText = parts[1].trim();
    if (numeratorText === "" || denominatorText === "") {
        throw invalidNumericText(text);
    }
    const numerator = toDouble(parseScalarText(numeratorText, text));
    const denominator = toDouble(parseScalarText(denominatorText, text));
    if (denominator === 0) {
        throw new Error("Division by zero: the denominator must not be zero");
    }
    return { kind: "float", value: finiteDouble(numerator / denominator, text) };
}

export function formatNumeric(value: NumericValue): string {
    return value.kind === "integer" ? value.value.toString() : floatText(value.value);
}

export function addNumeric(a: NumericValue, b: NumericValue): NumericValue {
    if (a.kind === "integer" && b.kind === "integer") {
        return { kind: "integer", value: a.value + b.value };
    }
    return { kind: "float", value: toDouble(a) + toDouble(b) };
}

export function subNumeric(a: NumericValue, b: NumericValue): NumericValue {
    if (a.kind === "integer" && b.kind === "integer") {
        return { kind: "integer", value: a.value - b.value };
    }
    return { kind: "float", value: toDouble(a) - toDouble(b) };
}

export function mulNumeric(a: NumericValue, b: NumericValue): NumericValue {
    if (a.kind === "integer" && b.kind === "integer") {
        return { kind: "integer", value: a.value * b.value };
    }
    return { kind: "float", value: toDouble(a) * toDouble(b) };
}

export function sumNumerics(values: NumericInput[]): NumericValue {
    const parsed = values.map(parseNumeric);
    let total = 0n;
    let integral = true;
    for (const value of parsed) {
        if (value.kind !== "integer") {
            integral = false;
            break;
        }
        total += value.value;
    }
    if (integral) {
        return { kind: "integer", value: total };
    }
    return { kind: "float", value: parsed.reduce((acc, value) => acc + toDouble(value), 0) };
}

export function divideNumeric(a: NumericValue, b: NumericValue): NumericValue {
    const divisor = toDouble(b);
    if (divisor === 0) {
        throw new Error("Division by zero: the denominator must not be zero");
    }
    return { kind: "float", value: toDouble(a) / divisor };
}

export function remainderNumeric(a: NumericValue, b: NumericValue): NumericValue {
    if (b.kind === "integer" && b.value === 0n) {
        throw new Error("Modulo by zero: the denominator must not be zero");
    }
    if (a.kind === "integer" && b.kind === "integer") {
        return { kind: "integer", value: a.value % b.value };
    }
    const divisor = toDouble(b);
    if (divisor === 0) {
        throw new Error("Modulo by zero: the denominator must not be zero");
    }
    return { kind: "float", value: toDouble(a) % divisor };
}

export function floorNumeric(value: NumericValue): string {
    return value.kind === "integer" ? value.value.toString() : floatText(Math.floor(value.value));
}

export function ceilNumeric(value: NumericValue): string {
    return value.kind === "integer" ? value.value.toString() : floatText(Math.ceil(value.value));
}

function roundHalfEven(value: number): number {
    const lower = Math.floor(value);
    const fraction = value - lower;
    if (fraction < 0.5) {
        return lower;
    }
    if (fraction > 0.5) {
        return lower + 1;
    }
    return lower % 2 === 0 ? lower : lower + 1;
}

export function roundNumeric(value: NumericValue, mode: RoundMode): string {
    if (value.kind === "integer") {
        return value.value.toString();
    }
    const input = value.value;
    switch (mode) {
        case "truncate":
            return floatText(Math.trunc(input));
        case "half-up":
            return floatText(Math.sign(input) * Math.floor(Math.abs(input) + 0.5));
        case "half-even":
            return floatText(roundHalfEven(input));
        case "js-round":
            return floatText(Math.round(input));
    }
}

export function compareNumeric(a: NumericValue, b: NumericValue): number {
    if (a.kind === "integer" && b.kind === "integer") {
        return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    }
    const left = toDouble(a);
    const right = toDouble(b);
    return left < right ? -1 : left > right ? 1 : 0;
}
