/**
 * Calculate MCP Server - Operation Registry
 *
 * All operations are declared here with their description, schema, execution logic,
 * and formatters. Both individual tools and batch_calc are synthesized from this registry.
 */

import { z } from "zod";
import { IntegerConversion } from "./modules/integer.js";
import { Bitwise, BitwiseOp, BitWidth } from "./modules/bitwise.js";
import { Endianness } from "./modules/endianness.js";
import { IEEE754 } from "./modules/ieee754.js";
import { CryptoCalc } from "./modules/crypto.js";
import { DataCodec } from "./modules/codec.js";

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

export const ops: Record<string, OpDefinition> = {
    // -------------------------------------------------------------
    // 1. Basic Arithmetic & Rounding
    // -------------------------------------------------------------
    add: {
        description: "Adds two numbers",
        shape: {
            firstNumber: numberInput.describe("The first addend"),
            secondNumber: numberInput.describe("The second addend")
        },
        run: ({ firstNumber, secondNumber }) => firstNumber + secondNumber,
        format: plain
    },
    subtract: {
        description: "Subtracts the second number from the first",
        shape: {
            minuend: numberInput.describe("The number to subtract from (minuend)"),
            subtrahend: numberInput.describe("The number being subtracted (subtrahend)")
        },
        run: ({ minuend, subtrahend }) => minuend - subtrahend,
        format: plain
    },
    multiply: {
        description: "Multiplies two numbers",
        shape: {
            firstNumber: numberInput.describe("The first number"),
            secondNumber: numberInput.describe("The second number")
        },
        run: ({ firstNumber, secondNumber }) => firstNumber * secondNumber,
        format: plain
    },
    division: {
        description: "Divides the first number by the second",
        shape: {
            numerator: numberInput.describe("The number being divided (numerator)"),
            denominator: numberInput.describe("The number to divide by (denominator)")
        },
        run: ({ numerator, denominator }) => numerator / denominator,
        format: plain
    },
    sum: {
        description: "Adds any number of numbers together",
        shape: {
            numbers: z.array(z.number()).min(1).describe("Array of numbers to sum")
        },
        run: ({ numbers }) => numbers.reduce((acc: number, cur: number) => acc + cur, 0),
        format: plain
    },
    modulo: {
        description: "Returns the remainder of a division",
        shape: {
            numerator: numberInput.describe("The number being divided (numerator)"),
            denominator: numberInput.describe("The number to divide by (denominator)")
        },
        run: ({ numerator, denominator }) => numerator % denominator,
        format: plain
    },
    floor: {
        description: "Rounds a number down to the nearest integer",
        shape: {
            number: numberInput.describe("The number to round down")
        },
        run: ({ number }) => Math.floor(number),
        format: plain
    },
    ceiling: {
        description: "Rounds a number up to the nearest integer",
        shape: {
            number: numberInput.describe("The number to round up")
        },
        run: ({ number }) => Math.ceil(number),
        format: plain
    },
    round: {
        description: "Rounds a number to the nearest integer",
        shape: {
            number: numberInput.describe("The number to round")
        },
        run: ({ number }) => Math.round(number),
        format: plain
    },

    // -------------------------------------------------------------
    // 2. Statistics
    // -------------------------------------------------------------
    mean: {
        description: "Calculates the arithmetic mean of a list of numbers",
        shape: {
            numbers: z.array(z.number()).min(1).describe("Array of numbers to find the mean of")
        },
        run: ({ numbers }) => numbers.reduce((a: number, b: number) => a + b, 0) / numbers.length,
        format: plain
    },
    median: {
        description: "Calculates the median of a list of numbers",
        shape: {
            numbers: z.array(z.number()).min(1).describe("Array of numbers to find the median of")
        },
        run: ({ numbers }) => {
            const sorted = [...numbers].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        },
        format: plain
    },
    mode: {
        description: "Finds the most common number in a list of numbers",
        shape: {
            numbers: z.array(z.number()).describe("Array of numbers to find the mode of")
        },
        run: ({ numbers }) => {
            const freqMap = new Map<number, number>();
            let maxFreq = 0;
            for (const num of numbers) {
                const count = (freqMap.get(num) || 0) + 1;
                freqMap.set(num, count);
                if (count > maxFreq) maxFreq = count;
            }
            const modes: number[] = [];
            for (const [num, count] of freqMap.entries()) {
                if (count === maxFreq) modes.push(num);
            }
            return { modeResult: modes, maxFrequency: maxFreq };
        },
        format: (value) => `Entries (${value.modeResult.join(', ')}) appeared ${value.maxFrequency} times`
    },
    min: {
        description: "Finds the minimum value from a list of numbers",
        shape: {
            numbers: z.array(z.number()).describe("Array of numbers to find the minimum of")
        },
        run: ({ numbers }) => Math.min(...numbers),
        format: plain
    },
    max: {
        description: "Finds the maximum value from a list of numbers",
        shape: {
            numbers: z.array(z.number()).describe("Array of numbers to find the maximum of")
        },
        run: ({ numbers }) => Math.max(...numbers),
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
            value: z.union([z.string(), z.number()]).optional().describe("Single integer value (e.g. '0x401000', '4198400', '0b1010', '0o77', -42, or 12345)"),
            values: z.array(z.union([z.string(), z.number()])).optional().describe("Multiple integer values to convert in batch")
        },
        run: ({ value, values }) => {
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
            const results = rawInputs.map(input => IntegerConversion.convert(input));
            return results.length === 1 ? results[0] : results;
        },
        format: json
    },
    bitwise: {
        description: "Performs bitwise operations (AND, OR, XOR, NOT, SHL, SHR, SAR, ROL, ROR) with 8/16/32/64-bit width",
        shape: {
            operation: z.enum(["and", "or", "xor", "not", "shl", "shr", "sar", "rol", "ror"]).describe("Bitwise operation"),
            a: z.union([z.string(), z.number()]).describe("First operand (number or hex string like '0x1234')"),
            b: z.union([z.string(), z.number()]).optional().describe("Second operand or shift count (not needed for NOT)"),
            bitWidth: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).optional().default(32).describe("Bit width (8, 16, 32, 64; default: 32)")
        },
        run: ({ operation, a, b, bitWidth }) => Bitwise.execute(operation as BitwiseOp, a, b, bitWidth as BitWidth),
        format: json
    },
    endian_swap: {
        description: "Swaps endianness (Big-Endian <-> Little-Endian) for hex values, numbers, or byte streams",
        shape: {
            value: z.union([z.string(), z.number()]).describe("Input value or hex stream (e.g. '0x12345678', 12345, or '010203040506')"),
            widthBytes: z.number().int().positive().optional().describe("Target byte length (2 for 16-bit, 4 for 32-bit, 8 for 64-bit; auto if omitted)")
        },
        run: ({ value, widthBytes }) => Endianness.swap(value, widthBytes),
        format: json
    },
    ieee754_convert: {
        description: "Converts and decomposes between Float/Double numbers and IEEE 754 binary/hex layout (Sign, Exponent, Mantissa)",
        shape: {
            value: z.union([z.string(), z.number()]).describe("Float number (e.g. 3.14159) or Hex representation (e.g. '0x3f800000', '0x400921fb54442d18')"),
            precision: z.enum(["float32", "float64", "both"]).optional().default("both").describe("Precision layout to analyze ('float32', 'float64', or 'both')")
        },
        run: ({ value, precision }) => IEEE754.convert(value, precision as "float32" | "float64" | "both"),
        format: json
    },
    crypto_calc: {
        description: "Computes cryptographic hashes (MD5, SHA1, SHA256), CRC checksums (CRC32, CRC16), and modular arithmetic (mod_pow, mod_inverse, gcd)",
        shape: {
            action: z.enum(["hash", "crc32", "crc16", "mod_pow", "mod_inverse", "gcd"]).describe("Operation to perform"),
            data: z.string().optional().describe("Input string or hex data (for hash, crc32, crc16)"),
            inputFormat: z.enum(["text", "hex"]).optional().default("text").describe("Format of data ('text' or 'hex')"),
            algorithm: z.enum(["md5", "sha1", "sha256"]).optional().default("md5").describe("Hash algorithm (for action='hash')"),
            crcVariant: z.enum(["ccitt", "modbus"]).optional().default("modbus").describe("CRC16 variant (for action='crc16')"),
            a: z.union([z.string(), z.number()]).optional().describe("First number / base / a (for mod_pow, mod_inverse, gcd)"),
            b: z.union([z.string(), z.number()]).optional().describe("Second number / exponent / b (for mod_pow, gcd)"),
            modulus: z.union([z.string(), z.number()]).optional().describe("Modulus (for mod_pow, mod_inverse)")
        },
        run: ({ action, data, inputFormat, algorithm, crcVariant, a, b, modulus }) => {
            switch (action) {
                case "hash":
                    if (!data) throw new Error("Missing 'data' for hash operation");
                    return CryptoCalc.hash(algorithm, data, inputFormat);
                case "crc32":
                    if (!data) throw new Error("Missing 'data' for crc32 operation");
                    return CryptoCalc.crc32(data, inputFormat);
                case "crc16":
                    if (!data) throw new Error("Missing 'data' for crc16 operation");
                    return CryptoCalc.crc16(data, crcVariant, inputFormat);
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
        description: "Encodes and decodes data between Base64, Hex, ASCII/UTF-8 string, and URL formats",
        shape: {
            action: z.enum(["to_base64", "from_base64", "to_hex", "from_hex", "url_encode", "url_decode"]).describe("Codec operation"),
            input: z.string().describe("Input string to process"),
            format: z.enum(["text", "hex"]).optional().default("text").describe("Format of input (for to_base64) or output (for from_base64)"),
            urlSafe: z.boolean().optional().default(false).describe("Use URL-safe Base64 alphabet without padding")
        },
        run: ({ action, input, format, urlSafe }) => {
            switch (action) {
                case "to_base64":
                    return { base64: DataCodec.toBase64(input, format, urlSafe) };
                case "from_base64":
                    return { decoded: DataCodec.fromBase64(input, format) };
                case "to_hex":
                    return DataCodec.stringToHex(input);
                case "from_hex":
                    return { text: DataCodec.hexToString(input) };
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
