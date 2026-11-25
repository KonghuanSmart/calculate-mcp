export interface Float32Analysis {
    value: number;
    hex: string;
    binary: string;
    signBit: number;
    sign: string;
    rawExponentHex: string;
    rawExponentDec: number;
    biasedExponent: number;
    mantissaHex: string;
    mantissaFraction: number;
    type: "zero" | "subnormal" | "normal" | "infinity" | "nan";
}

export interface Float64Analysis {
    value: number;
    hex: string;
    binary: string;
    signBit: number;
    sign: string;
    rawExponentHex: string;
    rawExponentDec: number;
    biasedExponent: number;
    mantissaHex: string;
    mantissaFraction: number;
    type: "zero" | "subnormal" | "normal" | "infinity" | "nan";
}

export interface IEEE754Result {
    input: string | number;
    float32?: Float32Analysis;
    float64?: Float64Analysis;
}

export const IEEE754_PRECISIONS = ["float32", "float64", "both"] as const;
export type IeeePrecision = (typeof IEEE754_PRECISIONS)[number];

const HEX_WORD_PATTERN = /^(?:0[xX])?([0-9a-fA-F]+)$/;
const PRECISION_HEX_LENGTHS: Record<IeeePrecision, readonly number[]> = {
    float32: [8],
    float64: [16],
    both: [8, 16]
};

export class IEEE754 {
    /**
     * Parses and analyzes 32-bit float (Single precision).
     */
    public static analyzeFloat32(bytes: Uint8Array): Float32Analysis {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const floatVal = view.getFloat32(0, false); // Big-Endian read
        const uintVal = view.getUint32(0, false);

        const hex = "0x" + uintVal.toString(16).padStart(8, "0");
        const binary = "0b" + uintVal.toString(2).padStart(32, "0");

        const signBit = (uintVal >>> 31) & 1;
        const rawExp = (uintVal >>> 23) & 0xff;
        const mantissa = uintVal & 0x7fffff;

        let type: Float32Analysis["type"] = "normal";
        if (rawExp === 0) {
            type = mantissa === 0 ? "zero" : "subnormal";
        } else if (rawExp === 0xff) {
            type = mantissa === 0 ? "infinity" : "nan";
        }

        const biasedExp = rawExp === 0 ? -126 : rawExp - 127;
        const mantissaFraction = mantissa / Math.pow(2, 23);

        return {
            value: floatVal,
            hex,
            binary,
            signBit,
            sign: signBit === 1 ? "-" : "+",
            rawExponentHex: "0x" + rawExp.toString(16).padStart(2, "0"),
            rawExponentDec: rawExp,
            biasedExponent: biasedExp,
            mantissaHex: "0x" + mantissa.toString(16).padStart(6, "0"),
            mantissaFraction,
            type
        };
    }

    /**
     * Parses and analyzes 64-bit float (Double precision).
     */
    public static analyzeFloat64(bytes: Uint8Array): Float64Analysis {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const doubleVal = view.getFloat64(0, false); // Big-Endian read
        const bigUint = view.getBigUint64(0, false);

        const hex = "0x" + bigUint.toString(16).padStart(16, "0");
        const binary = "0b" + bigUint.toString(2).padStart(64, "0");

        const signBit = Number((bigUint >> 63n) & 1n);
        const rawExp = Number((bigUint >> 52n) & 0x7ffn);
        const mantissa = bigUint & 0xfffffffffffffn;

        let type: Float64Analysis["type"] = "normal";
        if (rawExp === 0) {
            type = mantissa === 0n ? "zero" : "subnormal";
        } else if (rawExp === 0x7ff) {
            type = mantissa === 0n ? "infinity" : "nan";
        }

        const biasedExp = rawExp === 0 ? -1022 : rawExp - 1023;
        const mantissaFraction = Number(mantissa) / Math.pow(2, 52);

        return {
            value: doubleVal,
            hex,
            binary,
            signBit,
            sign: signBit === 1 ? "-" : "+",
            rawExponentHex: "0x" + rawExp.toString(16).padStart(3, "0"),
            rawExponentDec: rawExp,
            biasedExponent: biasedExp,
            mantissaHex: "0x" + mantissa.toString(16).padStart(13, "0"),
            mantissaFraction,
            type
        };
    }

    /**
     * Converts a float number or hex machine word into IEEE 754 analysis.
     */
    public static convert(input: string | number, precision: IeeePrecision = "both"): IEEE754Result {
        if (typeof input === "string") {
            const word = this.hexWordBytes(input, precision);
            if (word.length === 4) {
                const f32 = this.analyzeFloat32(new Uint8Array(word));
                const f64Buf = Buffer.alloc(8);
                f64Buf.writeDoubleBE(f32.value, 0);
                const f64 = this.analyzeFloat64(new Uint8Array(f64Buf));
                return this.selectPrecision(input, f32, f64, precision);
            }
            const f64 = this.analyzeFloat64(new Uint8Array(word));
            const f32Buf = Buffer.alloc(4);
            f32Buf.writeFloatBE(f64.value, 0);
            const f32 = this.analyzeFloat32(new Uint8Array(f32Buf));
            return this.selectPrecision(input, f32, f64, precision);
        }

        if (Number.isNaN(input)) {
            throw new Error("Invalid float input: NaN");
        }

        const buf32 = Buffer.alloc(4);
        buf32.writeFloatBE(input, 0);
        const f32 = this.analyzeFloat32(new Uint8Array(buf32));

        const buf64 = Buffer.alloc(8);
        buf64.writeDoubleBE(input, 0);
        const f64 = this.analyzeFloat64(new Uint8Array(buf64));

        return this.selectPrecision(input, f32, f64, precision);
    }

    /**
     * Reads a hex machine word, rejecting anything that is not exactly the length its precision needs.
     */
    private static hexWordBytes(input: string, precision: IeeePrecision): Buffer {
        const match = HEX_WORD_PATTERN.exec(input.trim());
        if (match === null) {
            throw new Error(`Invalid IEEE 754 input "${input}": a string is read as a hex machine word (hex digits, optionally with a 0x prefix); pass a decimal float as a number instead (e.g. 3.5)`);
        }
        const digits = match[1];
        const lengths = PRECISION_HEX_LENGTHS[precision];
        if (!lengths.includes(digits.length)) {
            const expected = lengths
                .map(length => `${length} hex characters for ${length === 8 ? "float32" : "float64"}`)
                .join(" or ");
            throw new Error(`Invalid IEEE 754 hex word "${input}": expected exactly ${expected}, got ${digits.length}; pass a decimal float as a number instead (e.g. 3.5)`);
        }
        return Buffer.from(digits, "hex");
    }

    private static selectPrecision(
        input: string | number,
        f32: Float32Analysis,
        f64: Float64Analysis,
        precision: IeeePrecision
    ): IEEE754Result {
        return {
            input,
            float32: precision === "float64" ? undefined : f32,
            float64: precision === "float32" ? undefined : f64
        };
    }
}
