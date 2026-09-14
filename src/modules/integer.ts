/**
 * Integer conversion utility for MCP server.
 * Provides conversions between Decimal, Hexadecimal, Binary, Octal,
 * signed/unsigned bit widths, and endianness representation.
 */

export interface ConversionResult {
    input: string | number;
    decimal: string;
    hex: string;
    hexUpper: string;
    binary: string;
    binaryFormatted: string;
    octal: string;
    ascii?: string;
    bitWidths: {
        bit8: {
            unsigned: number;
            signed: number;
            hex: string;
        };
        bit16: {
            unsigned: number;
            signed: number;
            hex: string;
            littleEndianHex: string;
        };
        bit32: {
            unsigned: number;
            signed: number;
            hex: string;
            littleEndianHex: string;
        };
        bit64: {
            unsigned: string;
            signed: string;
            hex: string;
            littleEndianHex: string;
        };
    };
}

export class IntegerConversion {
    /**
     * Parses an integer input (string or number) into a BigInt safely.
     */
    public static parseToBigInt(raw: string | number): bigint {
        if (typeof raw === "number") {
            if (!Number.isFinite(raw)) {
                throw new Error(`Invalid numeric input: ${raw}`);
            }
            return BigInt(Math.trunc(raw));
        }

        const trimmed = raw.trim();
        if (!trimmed) {
            throw new Error("Input string cannot be empty");
        }

        try {
            // Handle negative hex/bin/oct prefixes like -0x10
            if (trimmed.startsWith("-0x") || trimmed.startsWith("-0X")) {
                return -BigInt("0x" + trimmed.slice(3));
            }
            if (trimmed.startsWith("-0b") || trimmed.startsWith("-0B")) {
                return -BigInt("0b" + trimmed.slice(3));
            }
            if (trimmed.startsWith("-0o") || trimmed.startsWith("-0O")) {
                return -BigInt("0o" + trimmed.slice(3));
            }

            return BigInt(trimmed);
        } catch {
            throw new Error(`Failed to parse integer value: "${raw}"`);
        }
    }

    /**
     * Swaps byte order for a hex string with specific byte length.
     */
    private static swapEndian(hexStr: string, byteLength: number): string {
        const padded = hexStr.padStart(byteLength * 2, "0");
        const bytes: string[] = [];
        for (let i = 0; i < padded.length; i += 2) {
            bytes.push(padded.slice(i, i + 2));
        }
        return "0x" + bytes.reverse().join("");
    }

    /**
     * Formats binary string into chunks of 4 bits.
     */
    private static formatBinary(binStr: string): string {
        const isNeg = binStr.startsWith("-");
        const clean = binStr.replace(/^-?0b/, "");
        const remainder = clean.length % 4;
        const padded = remainder === 0 ? clean : clean.padStart(clean.length + (4 - remainder), "0");
        const chunks: string[] = [];
        for (let i = 0; i < padded.length; i += 4) {
            chunks.push(padded.slice(i, i + 4));
        }
        return (isNeg ? "-0b" : "0b") + chunks.join(" ");
    }

    /**
     * Converts an integer input to comprehensive representation formats.
     */
    public static convert(input: string | number): ConversionResult {
        const bigVal = this.parseToBigInt(input);

        // Calculate bit-width masks
        const u8 = Number(BigInt.asUintN(8, bigVal));
        const s8 = Number(BigInt.asIntN(8, bigVal));
        const hex8 = "0x" + u8.toString(16).padStart(2, "0");

        const u16 = Number(BigInt.asUintN(16, bigVal));
        const s16 = Number(BigInt.asIntN(16, bigVal));
        const hex16Raw = u16.toString(16).padStart(4, "0");
        const hex16 = "0x" + hex16Raw;
        const leHex16 = this.swapEndian(hex16Raw, 2);

        const u32 = Number(BigInt.asUintN(32, bigVal));
        const s32 = Number(BigInt.asIntN(32, bigVal));
        const hex32Raw = u32.toString(16).padStart(8, "0");
        const hex32 = "0x" + hex32Raw;
        const leHex32 = this.swapEndian(hex32Raw, 4);

        const u64 = BigInt.asUintN(64, bigVal);
        const s64 = BigInt.asIntN(64, bigVal);
        const hex64Raw = u64.toString(16).padStart(16, "0");
        const hex64 = "0x" + hex64Raw;
        const leHex64 = this.swapEndian(hex64Raw, 8);

        // General representation
        const isNegative = bigVal < 0n;
        const absVal = isNegative ? -bigVal : bigVal;
        const hexGeneral = (isNegative ? "-0x" : "0x") + absVal.toString(16);
        const hexUpper = (isNegative ? "-0x" : "0x") + absVal.toString(16).toUpperCase();
        const binGeneral = (isNegative ? "-0b" : "0b") + absVal.toString(2);
        const octGeneral = (isNegative ? "-0o" : "0o") + absVal.toString(8);

        // ASCII representation if applicable
        let ascii: string | undefined;
        if (bigVal >= 32n && bigVal <= 126n) {
            ascii = String.fromCharCode(Number(bigVal));
        }

        return {
            input,
            decimal: bigVal.toString(),
            hex: hexGeneral,
            hexUpper,
            binary: binGeneral,
            binaryFormatted: this.formatBinary(binGeneral),
            octal: octGeneral,
            ascii,
            bitWidths: {
                bit8: {
                    unsigned: u8,
                    signed: s8,
                    hex: hex8
                },
                bit16: {
                    unsigned: u16,
                    signed: s16,
                    hex: hex16,
                    littleEndianHex: leHex16
                },
                bit32: {
                    unsigned: u32,
                    signed: s32,
                    hex: hex32,
                    littleEndianHex: leHex32
                },
                bit64: {
                    unsigned: u64.toString(),
                    signed: s64.toString(),
                    hex: hex64,
                    littleEndianHex: leHex64
                }
            }
        };
    }
}
