/**
 * Calculate MCP Server - Operation Registry
 *
 * All operations are declared here with their description, schema, execution logic,
 * and formatters. Both individual tools and batch_calc are synthesized from this registry.
 */

import { z } from "zod";
import { IntegerConversion } from "./modules/integer.js";
import { Bitwise, BITWISE_OPERATIONS, BitWidth } from "./modules/bitwise.js";
import { Endianness } from "./modules/endianness.js";
import { IEEE754, IEEE754_PRECISIONS } from "./modules/ieee754.js";
import { CryptoCalc, parseHashAlgorithm } from "./modules/crypto.js";
import { DataCodec } from "./modules/codec.js";
import {
    NumericInput,
    NumericValue,
    ROUND_MODES,
    addNumeric,
    ceilNumeric,
    compareNumeric,
    divideNumeric,
    floorNumeric,
    formatNumeric,
    mulNumeric,
    parseNumeric,
    remainderNumeric,
    roundNumeric,
    subNumeric,
    sumNumerics
} from "./modules/arithmetic.js";

export interface OpDefinition {
    /** Brief capability description */
    description: string;
    shape: z.ZodRawShape;
    /** Execution handler */
    run: (args: any) => unknown;
    /** Output text formatter */
    format: (result: any) => string;
}

const plain = (result: unknown) => `${result}`;
const json = (result: unknown) => JSON.stringify(result, null, 2);
const numberInput = z.number();
const numericInput = z.union([z.number(), z.string()]);

const numericField = (description: string) =>
    numericInput.describe(`${description}; integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. "9007199254740993")`);

const BYTE_FORMATS = ["text", "hex"] as const;
const CRYPTO_ACTIONS = ["hash", "hmac", "aes_encrypt", "aes_decrypt", "crc32", "crc16", "mod_pow", "mod_inverse", "gcd"] as const;
const CRC16_VARIANTS = ["ccitt", "modbus"] as const;
const CODEC_ACTIONS = ["to_base64", "from_base64", "to_hex", "from_hex", "url_encode", "url_decode"] as const;

const NORMALIZED_HINT = "case-insensitive; '_', '-', and spaces are interchangeable";

function textWithPrecision(value: NumericValue, precision?: number): string {
    if (precision === undefined || value.kind === "integer") {
        return formatNumeric(value);
    }
    return formatNumeric({ kind: "float", value: Number(value.value.toFixed(precision)) });
}

interface DivisionResult {
    value: string;
    quotient?: string;
    remainder?: string;
}

function divideIntoResult(numerator: NumericInput, denominator: NumericInput): DivisionResult {
    const dividend = parseNumeric(numerator);
    const divisor = parseNumeric(denominator);
    const approximate = formatNumeric(divideNumeric(dividend, divisor));
    if (dividend.kind === "integer" && divisor.kind === "integer") {
        const quotient = dividend.value / divisor.value;
        const remainder = dividend.value % divisor.value;
        return {
            value: remainder === 0n ? quotient.toString() : approximate,
            quotient: quotient.toString(),
            remainder: remainder.toString()
        };
    }
    return { value: approximate };
}

const COMPACT_INT_FIELDS = ["input", "decimal", "hex", "binary"];

function pickConversionFields(full: Record<string, any>, fields: string[]): Record<string, any> {
    const selected: Record<string, any> = {};
    for (const path of fields) {
        const segments = path.split(".");
        let source: any = full;
        let target: any = selected;
        segments.forEach((segment, index) => {
            if (source === null || typeof source !== "object" || !(segment in source)) {
                throw new Error(`Unknown int_convert field "${path}"; available fields: ${Object.keys(full).join(", ")}`);
            }
            if (index === segments.length - 1) {
                target[segment] = source[segment];
                return;
            }
            target[segment] = target[segment] ?? {};
            target = target[segment];
            source = source[segment];
        });
    }
    return selected;
}

function selectConversionFields(result: Record<string, any>, compact?: boolean, fields?: string[]): Record<string, any> {
    if (fields !== undefined && fields.length > 0) {
        return pickConversionFields(result, fields);
    }
    if (compact) {
        const selected: Record<string, any> = {};
        for (const key of COMPACT_INT_FIELDS) {
            selected[key] = result[key];
        }
        if (result.twosComplementHex !== undefined) {
            selected.twosComplementHex = result.twosComplementHex;
        }
        return selected;
    }
    return result;
}

function selectOption<T extends string>(value: string, allowed: readonly T[], label: string): T {
    const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
    const match = allowed.find(option => option.trim().toLowerCase().replace(/[\s_-]+/g, "") === normalized);
    if (match === undefined) {
        throw new Error(`Unknown ${label} "${value}"; expected one of: ${allowed.join(", ")}`);
    }
    return match;
}

export const ops: Record<string, OpDefinition> = {
    // -------------------------------------------------------------
    // 1. Basic Arithmetic & Rounding
    // -------------------------------------------------------------
    add: {
        description: "Adds two numbers; integer inputs (decimal, 0x) stay exact at any size, any decimal or exponent input uses IEEE-754 doubles",
        shape: {
            firstNumber: numericField("The first addend (number, or numeric string such as '9007199254740993', '0x10', '-42')"),
            secondNumber: numericField("The second addend")
        },
        run: ({ firstNumber, secondNumber }) => formatNumeric(addNumeric(parseNumeric(firstNumber), parseNumeric(secondNumber))),
        format: plain
    },
    subtract: {
        description: "Subtracts the second number from the first; integer inputs stay exact at any size, any decimal or exponent input uses IEEE-754 doubles",
        shape: {
            minuend: numericField("The number to subtract from (minuend)"),
            subtrahend: numericField("The number being subtracted (subtrahend)")
        },
        run: ({ minuend, subtrahend }) => formatNumeric(subNumeric(parseNumeric(minuend), parseNumeric(subtrahend))),
        format: plain
    },
    multiply: {
        description: "Multiplies two numbers; integer inputs stay exact at any size, any decimal or exponent input uses IEEE-754 doubles",
        shape: {
            firstNumber: numericField("The first number"),
            secondNumber: numericField("The second number")
        },
        run: ({ firstNumber, secondNumber }) => formatNumeric(mulNumeric(parseNumeric(firstNumber), parseNumeric(secondNumber))),
        format: plain
    },
    division: {
        description: "Divides the first number by the second; two integer operands return the exact integer when the division comes out even, the double approximation otherwise, plus the exact truncated quotient and remainder",
        shape: {
            numerator: numericField("The number being divided (numerator)"),
            denominator: numericField("The number to divide by (denominator)")
        },
        run: ({ numerator, denominator }) => divideIntoResult(numerator, denominator),
        format: json
    },
    sum: {
        description: "Adds any number of numbers; integer inputs stay exact at any size, any decimal or exponent input uses IEEE-754 doubles",
        shape: {
            numbers: z.array(numericInput).min(1)
                .describe("Array of numbers to sum; integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")")
        },
        run: ({ numbers }) => formatNumeric(sumNumerics(numbers)),
        format: plain
    },
    modulo: {
        description: "Returns the remainder of a division, truncated toward zero like C (the sign follows the numerator)",
        shape: {
            numerator: numericField("The number being divided (numerator)"),
            denominator: numericField("The number to divide by (denominator)")
        },
        run: ({ numerator, denominator }) => formatNumeric(remainderNumeric(parseNumeric(numerator), parseNumeric(denominator))),
        format: plain
    },
    floor: {
        description: "Rounds a number down to the nearest integer",
        shape: {
            number: numericInput.describe("The number to round down (number or decimal/0x/fraction string); integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")")
        },
        run: ({ number }) => floorNumeric(parseNumeric(number)),
        format: plain
    },
    ceiling: {
        description: "Rounds a number up to the nearest integer",
        shape: {
            number: numericInput.describe("The number to round up (number or decimal/0x/fraction string); integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")")
        },
        run: ({ number }) => ceilNumeric(parseNumeric(number)),
        format: plain
    },
    round: {
        description: "Rounds a number to the nearest integer (default mode matches JavaScript Math.round)",
        shape: {
            number: numericInput.describe("The number to round (number or decimal/0x/fraction string); integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")"),
            mode: z.string().optional().default("js-round")
                .describe("Rounding mode (case-insensitive; '-' and '_' are interchangeable, so 'HALF-EVEN' and 'half_even' both work): 'js-round' (default, ties toward +Infinity, identical to Math.round), 'half-up' (ties away from zero), 'half-even' (banker's rounding), 'truncate' (toward zero); unknown values return an error listing the accepted modes")
        },
        run: ({ number, mode }) => roundNumeric(parseNumeric(number), selectOption(mode, ROUND_MODES, "rounding mode")),
        format: plain
    },

    // -------------------------------------------------------------
    // 2. Statistics
    // -------------------------------------------------------------
    mean: {
        description: "Calculates the arithmetic mean",
        shape: {
            numbers: z.array(numericInput).min(1)
                .describe("Array of numbers to find the mean of; integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")"),
            precision: z.number().int().min(0).max(100).optional().describe("Optional maximum number of digits after the decimal point")
        },
        run: ({ numbers, precision }) => textWithPrecision(
            divideNumeric(sumNumerics(numbers), { kind: "integer", value: BigInt(numbers.length) }),
            precision
        ),
        format: plain
    },
    median: {
        description: "Calculates the median of a list of numbers",
        shape: {
            numbers: z.array(numericInput).min(1)
                .describe("Array of numbers to find the median of; integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")"),
            precision: z.number().int().min(0).max(100).optional().describe("Optional maximum number of digits after the decimal point")
        },
        run: ({ numbers, precision }) => {
            const sorted = numbers.map((value: NumericInput) => parseNumeric(value)).sort(compareNumeric);
            const mid = Math.floor(sorted.length / 2);
            const value = sorted.length % 2 !== 0
                ? sorted[mid]
                : divideNumeric(addNumeric(sorted[mid - 1], sorted[mid]), { kind: "integer", value: 2n });
            return textWithPrecision(value, precision);
        },
        format: plain
    },
    mode: {
        description: "Finds the most common number in a list of numbers; returns the value(s) as a JSON array",
        shape: {
            numbers: z.array(numericInput).min(1).describe("Array of numbers to find the mode of (numbers or decimal/0x/fraction strings, at least one); integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")")
        },
        run: ({ numbers }) => {
            if (numbers.length === 0) {
                throw new Error("mode requires at least one number");
            }
            const counts = new Map<string, { value: NumericValue; count: number }>();
            let maxFreq = 0;
            for (const item of numbers) {
                const value = parseNumeric(item);
                const key = formatNumeric(value);
                const count = (counts.get(key)?.count ?? 0) + 1;
                counts.set(key, { value, count });
                if (count > maxFreq) maxFreq = count;
            }
            const modes: string[] = [];
            for (const { value, count } of counts.values()) {
                if (count === maxFreq) modes.push(formatNumeric(value));
            }
            return modes;
        },
        format: json
    },
    min: {
        description: "Finds the minimum value from a list of numbers",
        shape: {
            numbers: z.array(numericInput).min(1).describe("Array of numbers to find the minimum of (numbers or decimal/0x/fraction strings, at least one); integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")")
        },
        run: ({ numbers }) => {
            if (numbers.length === 0) {
                throw new Error("min requires at least one number");
            }
            const values: NumericValue[] = numbers.map((value: NumericInput) => parseNumeric(value));
            return formatNumeric(values.reduce((best, current) => (compareNumeric(current, best) < 0 ? current : best)));
        },
        format: plain
    },
    max: {
        description: "Finds the maximum value from a list of numbers",
        shape: {
            numbers: z.array(numericInput).min(1).describe("Array of numbers to find the maximum of (numbers or decimal/0x/fraction strings, at least one); integers beyond Number.MAX_SAFE_INTEGER must be passed as strings (e.g. \"9007199254740993\")")
        },
        run: ({ numbers }) => {
            if (numbers.length === 0) {
                throw new Error("max requires at least one number");
            }
            const values: NumericValue[] = numbers.map((value: NumericInput) => parseNumeric(value));
            return formatNumeric(values.reduce((best, current) => (compareNumeric(current, best) > 0 ? current : best)));
        },
        format: plain
    },

    // -------------------------------------------------------------
    // 3. Trigonometry
    // -------------------------------------------------------------
    sin: {
        description: "Calculates the sine of a number in radians",
        shape: {
            number: numberInput.describe("The number in radians to find the sine of")
        },
        run: ({ number }) => Math.sin(number),
        format: plain
    },
    arcsin: {
        description: "Calculates the arcsine (in radians) of a number",
        shape: {
            number: numberInput.describe("The number to find the arcsine of")
        },
        run: ({ number }) => Math.asin(number),
        format: plain
    },
    cos: {
        description: "Calculates the cosine of a number in radians",
        shape: {
            number: numberInput.describe("The number in radians to find the cosine of")
        },
        run: ({ number }) => Math.cos(number),
        format: plain
    },
    arccos: {
        description: "Calculates the arccosine (in radians) of a number",
        shape: {
            number: numberInput.describe("The number to find the arccosine of")
        },
        run: ({ number }) => Math.acos(number),
        format: plain
    },
    tan: {
        description: "Calculates the tangent of a number in radians",
        shape: {
            number: numberInput.describe("The number in radians to find the tangent of")
        },
        run: ({ number }) => Math.tan(number),
        format: plain
    },
    arctan: {
        description: "Calculates the arctangent (in radians) of a number",
        shape: {
            number: numberInput.describe("The number to find the arctangent of")
        },
        run: ({ number }) => Math.atan(number),
        format: plain
    },
    radiansToDegrees: {
        description: "Converts radians to degrees",
        shape: {
            number: numberInput.describe("The number in radians to convert to degrees")
        },
        run: ({ number }) => (number * 180) / Math.PI,
        format: plain
    },
    degreesToRadians: {
        description: "Converts degrees to radians",
        shape: {
            number: numberInput.describe("The number in degrees to convert to radians")
        },
        run: ({ number }) => (number * Math.PI) / 180,
        format: plain
    },

    // -------------------------------------------------------------
    // 4. Number Systems, Binary Data, and Cryptography
    // -------------------------------------------------------------
    int_convert: {
        description: "Converts integer(s) to Hex/Dec/Bin/Oct, 8/16/32/64-bit signed/unsigned, Little-Endian and ASCII",
        shape: {
            value: z.union([z.string(), z.number()]).optional().describe("Single integer value (e.g. '0x401000', '4198400', '0b1010', '0o77', '1010b', '1010o', '1010h', -42, or 12345)"),
            values: z.array(z.union([z.string(), z.number()])).optional().describe("Multiple integer values to convert in batch (same forms as 'value')"),
            compact: z.boolean().optional().describe("Return a reduced result per value: input, decimal, hex, binary, plus twosComplementHex for negative inputs (default: false, full output)"),
            fields: z.array(z.string()).optional().describe("Return only these fields instead of the full result, e.g. ['decimal', 'hex', 'bitWidths.bit32.hex']")
        },
        run: ({ value, values, compact, fields }) => {
            const rawInputs: (string | number)[] = [];
            if (value !== undefined) {
                rawInputs.push(value);
            }
            if (values && Array.isArray(values)) {
                rawInputs.push(...values);
            }
            if (rawInputs.length === 0) {
                throw new Error("Must provide either 'value' or 'values'");
            }
            const results = rawInputs.map(input => selectConversionFields(IntegerConversion.convert(input), compact, fields));
            return results.length === 1 ? results[0] : results;
        },
        format: json
    },
    bitwise: {
        description: "Performs bitwise operations (AND, OR, XOR, NOT, SHL, SHR, SAR, ROL, ROR) with 8/16/32/64-bit width",
        shape: {
            operation: z.string()
                .describe("Bitwise operation (case-insensitive, so 'XOR', 'Xor' and 'xor' are equivalent); one of: and, or, xor, not, shl, shr, sar, rol, ror. Unknown values return an error listing the accepted operations"),
            a: z.union([z.string(), z.number()]).describe("First operand (number or hex string like '0x1234')"),
            b: z.union([z.string(), z.number()]).optional().describe("Second operand or shift count (not needed for NOT)"),
            bitWidth: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).optional().default(32).describe("Bit width (8, 16, 32, 64; default: 32)")
        },
        run: ({ operation, a, b, bitWidth }) => Bitwise.execute(selectOption(operation, BITWISE_OPERATIONS, "operation"), a, b, bitWidth as BitWidth),
        format: json
    },
    endian_swap: {
        description: "Swaps endianness (Big-Endian <-> Little-Endian) for hex values, numbers, or byte streams",
        shape: {
            value: z.union([z.string(), z.number()]).describe("Input value or hex stream (e.g. '0x12345678', 12345, '12 34 56 78', or '010203040506'); a bare hex string of even length is read as a byte stream, any other numeric string as an integer"),
            widthBytes: z.number().int().positive().optional().describe("Target byte length (2 for 16-bit, 4 for 32-bit, 8 for 64-bit; auto if omitted)")
        },
        run: ({ value, widthBytes }) => Endianness.swap(value, widthBytes),
        format: json
    },
    ieee754_convert: {
        description: "Converts and decomposes between Float/Double numbers and IEEE 754 binary/hex layout (Sign, Exponent, Mantissa)",
        shape: {
            value: z.union([z.string(), z.number()]).describe("Decimal float as a number (e.g. 3.14159), or a hex machine word as a string (e.g. '0x3f800000', '0x400921fb54442d18'). A string is always read as a hex machine word and must be exactly 8 hex characters (float32) or 16 (float64); decimal strings are rejected, so pass them as numbers"),
            precision: z.string().optional().default("both").describe(`Precision layout to analyze (${NORMALIZED_HINT}, so 'FLOAT64' works); one of: float32, float64, both (default: both). A hex word must be 8 hex characters for float32 and 16 for float64; unknown values return an error listing the accepted precisions`)
        },
        run: ({ value, precision }) => IEEE754.convert(value, selectOption(precision, IEEE754_PRECISIONS, "precision")),
        format: json
    },
    crypto_calc: {
        description: "Computes hashes (MD5, SHA1, SHA256, SHA384, SHA512), HMACs, AES-CBC encryption/decryption, CRC checksums (CRC32, CRC16), and modular arithmetic (mod_pow, mod_inverse, gcd)",
        shape: {
            action: z.string().describe(`Operation to perform (${NORMALIZED_HINT}, so 'HASH' and 'mod_pow' both work); one of: hash, hmac, aes_encrypt, aes_decrypt, crc32, crc16, mod_pow, mod_inverse, gcd. Unknown values return an error listing the accepted actions`),
            data: z.string().optional().describe("Input string, hex data, or ciphertext (for hash, hmac, aes_encrypt, aes_decrypt, crc32, crc16)"),
            key: z.string().optional().describe("Secret key (any length for action='hmac'; exactly 16, 24, or 32 bytes for AES-128/192/256)"),
            iv: z.string().optional().describe("16-byte initialization vector for action='aes_encrypt'/'aes_decrypt', decoded using keyFormat"),
            inputFormat: z.string().optional().default("text").describe(`Format of 'data' (and of 'key' for action='hmac') (${NORMALIZED_HINT}); 'text' or 'hex'`),
            keyFormat: z.string().optional().default("text").describe(`Format of 'key' and 'iv' for AES actions (${NORMALIZED_HINT}); 'text' or 'hex'`),
            algorithm: z.string().default("md5")
                .describe("Hash algorithm for action='hash'/'hmac': md5, sha1, sha256, sha384, sha512 (case-insensitive; 'SHA-256', 'sha_256' and 'SHA512' are accepted); default: md5. Unknown values return an error listing the accepted algorithms"),
            crcVariant: z.string().optional().default("modbus").describe(`CRC16 variant for action='crc16' (${NORMALIZED_HINT}, so 'CCITT' works); 'ccitt' or 'modbus' (default: modbus)`),
            a: z.union([z.string(), z.number()]).optional().describe("First number / base / a (for mod_pow, mod_inverse, gcd)"),
            b: z.union([z.string(), z.number()]).optional().describe("Second number / exponent / b (for mod_pow, gcd)"),
            modulus: z.union([z.string(), z.number()]).optional().describe("Modulus (for mod_pow, mod_inverse)")
        },
        run: ({ action, data, key, iv, inputFormat, keyFormat, algorithm, crcVariant, a, b, modulus }) => {
            const hashAlgorithm = parseHashAlgorithm(algorithm);
            const selectedAction = selectOption(action, CRYPTO_ACTIONS, "action");
            const dataFormat = selectOption(inputFormat, BYTE_FORMATS, "input format");
            const secretFormat = selectOption(keyFormat, BYTE_FORMATS, "key format");
            const selectedVariant = selectOption(crcVariant, CRC16_VARIANTS, "CRC16 variant");
            switch (selectedAction) {
                case "hash":
                    if (data === undefined) throw new Error("Missing 'data' for hash operation");
                    return CryptoCalc.hash(hashAlgorithm, data, dataFormat);
                case "hmac":
                    if (data === undefined || key === undefined) throw new Error("hmac requires 'key' and 'data'");
                    return CryptoCalc.hmac(hashAlgorithm, key, data, dataFormat);
                case "aes_encrypt":
                    if (data === undefined || key === undefined || iv === undefined) {
                        throw new Error("aes_encrypt requires 'data', 'key', and 'iv'");
                    }
                    return CryptoCalc.aesEncrypt(key, iv, data, dataFormat, secretFormat);
                case "aes_decrypt":
                    if (data === undefined || key === undefined || iv === undefined) {
                        throw new Error("aes_decrypt requires 'data', 'key', and 'iv'");
                    }
                    return CryptoCalc.aesDecrypt(key, iv, data, dataFormat, secretFormat);
                case "crc32":
                    if (data === undefined) throw new Error("Missing 'data' for crc32 operation");
                    return CryptoCalc.crc32(data, dataFormat);
                case "crc16":
                    if (data === undefined) throw new Error("Missing 'data' for crc16 operation");
                    return CryptoCalc.crc16(data, selectedVariant, dataFormat);
                case "mod_pow":
                    if (a === undefined || b === undefined || modulus === undefined) {
                        throw new Error("mod_pow requires 'a' (base), 'b' (exponent), and 'modulus'");
                    }
                    return CryptoCalc.modPow(a, b, modulus);
                case "mod_inverse":
                    if (a === undefined || modulus === undefined) {
                        throw new Error("mod_inverse requires 'a' and 'modulus'");
                    }
                    return CryptoCalc.modInverse(a, modulus);
                case "gcd":
                    if (a === undefined || b === undefined) {
                        throw new Error("gcd requires 'a' and 'b'");
                    }
                    return CryptoCalc.gcd(a, b);
            }
        },
        format: json
    },
    data_codec: {
        description: "Encodes and decodes data between Base64, Hex, ASCII/UTF-8 string, and URL formats; decoding always returns a lossless hex view of the raw bytes",
        shape: {
            action: z.string().describe(`Codec operation (${NORMALIZED_HINT}, so 'TO_HEX', 'toHex' and 'to_hex' all work); one of: to_base64, from_base64, to_hex, from_hex, url_encode, url_decode. Unknown values return an error listing the accepted actions`),
            input: z.string().describe("Input string to process"),
            format: z.string().optional().default("text").describe(`Format of 'input' for action='to_base64' (${NORMALIZED_HINT}); 'text' or 'hex'. Both decode actions always return hex plus byte length, so this value does not change their output`),
            urlSafe: z.boolean().optional().default(false).describe("Use URL-safe Base64 alphabet without padding")
        },
        run: ({ action, input, format, urlSafe }) => {
            const selectedFormat = selectOption(format, BYTE_FORMATS, "format");
            switch (selectOption(action, CODEC_ACTIONS, "action")) {
                case "to_base64":
                    return { base64: DataCodec.toBase64(input, selectedFormat, urlSafe) };
                case "from_base64": {
                    const view = DataCodec.describeBytes(DataCodec.fromBase64(input));
                    return selectedFormat === "hex" ? { ...view, decoded: view.hex } : view;
                }
                case "to_hex":
                    return DataCodec.stringToHex(input);
                case "from_hex": {
                    const view = DataCodec.describeBytes(DataCodec.hexToBuffer(input));
                    const { decoded, ...rest } = view;
                    return decoded === undefined ? rest : { ...rest, text: decoded };
                }
                case "url_encode":
                    return { encoded: DataCodec.urlEncode(input) };
                case "url_decode":
                    return { decoded: DataCodec.urlDecode(input) };
            }
        },
        format: json
    }
};

export const opNames = Object.keys(ops) as [string, ...string[]];
