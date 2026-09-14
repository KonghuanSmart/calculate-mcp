import { IntegerConversion } from "./integer.js";

export interface EndiannessResult {
    input: string | number;
    byteCount: number;
    bigEndianHex: string;
    littleEndianHex: string;
    byteArray: number[];
    reversedByteArray: number[];
    hexFormatted: string;
}

export class Endianness {
    /**
     * Normalizes an input (hex string, number, or raw bytes) into a byte array (Big-Endian).
     */
    public static toBytes(input: string | number, widthBytes?: number): number[] {
        if (typeof input === "number" || (typeof input === "string" && !input.startsWith("0x") && !input.startsWith("0X") && /^-?\d+$/.test(input.trim()))) {
            const bigVal = IntegerConversion.parseToBigInt(input);
            const autoBytes = widthBytes || (bigVal > 0xffffffffn || bigVal < -0x80000000n ? 8 : (bigVal > 0xffffn || bigVal < -0x8000n ? 4 : (bigVal > 0xffn || bigVal < -0x80n ? 2 : 1)));
            const bytes: number[] = [];
            let val = BigInt.asUintN(autoBytes * 8, bigVal);
            for (let i = 0; i < autoBytes; i++) {
                bytes.unshift(Number(val & 0xffn));
                val >>= 8n;
            }
            return bytes;
        }

        // Hex string
        let cleanHex = input.trim().replace(/^0x/i, "").replace(/[\s_]/g, "");
        if (cleanHex.length % 2 !== 0) {
            cleanHex = "0" + cleanHex;
        }

        const bytes: number[] = [];
        for (let i = 0; i < cleanHex.length; i += 2) {
            bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
        }

        if (widthBytes && bytes.length < widthBytes) {
            while (bytes.length < widthBytes) {
                bytes.unshift(0);
            }
        }

        return bytes;
    }

    /**
     * Swaps endianness of an input (Big-Endian <-> Little-Endian).
     */
    public static swap(input: string | number, widthBytes?: number): EndiannessResult {
        const beBytes = this.toBytes(input, widthBytes);
        const leBytes = [...beBytes].reverse();

        const beHex = "0x" + beBytes.map(b => b.toString(16).padStart(2, "0")).join("");
        const leHex = "0x" + leBytes.map(b => b.toString(16).padStart(2, "0")).join("");
        const hexFormatted = beBytes.map(b => b.toString(16).padStart(2, "0")).join(" ");

        return {
            input,
            byteCount: beBytes.length,
            bigEndianHex: beHex,
            littleEndianHex: leHex,
            byteArray: beBytes,
            reversedByteArray: leBytes,
            hexFormatted
        };
    }
}
