import * as crypto from "crypto";
import { IntegerConversion } from "./integer.js";

export class CryptoCalc {
    /**
     * Calculates MD5, SHA-1, or SHA-256 hash of text or hex buffer.
     */
    public static hash(
        algorithm: "md5" | "sha1" | "sha256",
        data: string,
        inputFormat: "text" | "hex" = "text"
    ): { algorithm: string; input: string; hex: string; base64: string } {
        const buf = inputFormat === "hex"
            ? Buffer.from(data.replace(/^0x/i, "").replace(/[\s_]/g, ""), "hex")
            : Buffer.from(data, "utf8");

        const h = crypto.createHash(algorithm).update(buf);
        return {
            algorithm,
            input: data,
            hex: h.copy().digest("hex"),
            base64: h.digest("base64")
        };
    }

    /**
     * Calculates standard IEEE 802.3 CRC32 checksum.
     */
    public static crc32(data: string, inputFormat: "text" | "hex" = "text"): {
        checksumHex: string;
        checksumDec: number;
    } {
        const buf = inputFormat === "hex"
            ? Buffer.from(data.replace(/^0x/i, "").replace(/[\s_]/g, ""), "hex")
            : Buffer.from(data, "utf8");

        // Precomputed CRC32 table
        let crc = 0 ^ (-1);
        for (let i = 0; i < buf.length; i++) {
            let byte = buf[i];
            for (let j = 0; j < 8; j++) {
                const bit = (byte ^ crc) & 1;
                crc >>>= 1;
                if (bit) {
                    crc ^= 0xedb88320;
                }
                byte >>>= 1;
            }
        }
        const res = (crc ^ (-1)) >>> 0;
        return {
            checksumHex: "0x" + res.toString(16).padStart(8, "0"),
            checksumDec: res
        };
    }

    /**
     * Calculates CRC16-CCITT (polynomial 0x1021) or CRC16-MODBUS (polynomial 0xA001).
     */
    public static crc16(
        data: string,
        variant: "ccitt" | "modbus" = "modbus",
        inputFormat: "text" | "hex" = "text"
    ): { variant: string; checksumHex: string; checksumDec: number } {
        const buf = inputFormat === "hex"
            ? Buffer.from(data.replace(/^0x/i, "").replace(/[\s_]/g, ""), "hex")
            : Buffer.from(data, "utf8");

        let crc = variant === "modbus" ? 0xffff : 0x0000;
        const poly = variant === "modbus" ? 0xa001 : 0x1021;

        if (variant === "modbus") {
            for (let i = 0; i < buf.length; i++) {
                crc ^= buf[i];
                for (let j = 0; j < 8; j++) {
                    if ((crc & 0x0001) !== 0) {
                        crc = ((crc >>> 1) ^ poly) & 0xffff;
                    } else {
                        crc >>>= 1;
                    }
                }
            }
        } else {
            for (let i = 0; i < buf.length; i++) {
                crc ^= (buf[i] << 8);
                for (let j = 0; j < 8; j++) {
                    if ((crc & 0x8000) !== 0) {
                        crc = ((crc << 1) ^ poly) & 0xffff;
                    } else {
                        crc = (crc << 1) & 0xffff;
                    }
                }
            }
        }

        return {
            variant,
            checksumHex: "0x" + crc.toString(16).padStart(4, "0"),
            checksumDec: crc
        };
    }

    /**
     * BigInt Modular Exponentiation: (base ^ exponent) mod modulus
     * Essential for RSA encryption, decryption, and signature verification.
     */
    public static modPow(
        baseInput: string | number,
        expInput: string | number,
        modInput: string | number
    ): { base: string; exponent: string; modulus: string; resultDec: string; resultHex: string } {
        const base = IntegerConversion.parseToBigInt(baseInput);
        let exp = IntegerConversion.parseToBigInt(expInput);
        const mod = IntegerConversion.parseToBigInt(modInput);

        if (mod <= 0n) {
            throw new Error("Modulus must be positive");
        }
        if (exp < 0n) {
            throw new Error("Negative exponent not supported directly in modPow; use modular inverse first.");
        }

        let result = 1n;
        let b = ((base % mod) + mod) % mod;

        while (exp > 0n) {
            if (exp & 1n) {
                result = (result * b) % mod;
            }
            b = (b * b) % mod;
            exp >>= 1n;
        }

        return {
            base: base.toString(),
            exponent: expInput.toString(),
            modulus: mod.toString(),
            resultDec: result.toString(),
            resultHex: "0x" + result.toString(16)
        };
    }

    /**
     * Computes Greatest Common Divisor (GCD) using Euclidean algorithm.
     */
    public static gcd(aInput: string | number, bInput: string | number): { gcdDec: string; gcdHex: string } {
        let a = IntegerConversion.parseToBigInt(aInput);
        let b = IntegerConversion.parseToBigInt(bInput);
        a = a < 0n ? -a : a;
        b = b < 0n ? -b : b;

        while (b !== 0n) {
            const temp = b;
            b = a % b;
            a = temp;
        }

        return {
            gcdDec: a.toString(),
            gcdHex: "0x" + a.toString(16)
        };
    }

    /**
     * Extended Euclidean algorithm to compute modular inverse:
     * Finds x such that (a * x) % modulus === 1
     * Vital for RSA key generation / private exponent recovery.
     */
    public static modInverse(
        aInput: string | number,
        modInput: string | number
    ): { input: string; modulus: string; inverseDec: string; inverseHex: string } {
        let a = IntegerConversion.parseToBigInt(aInput);
        const m = IntegerConversion.parseToBigInt(modInput);

        if (m <= 1n) {
            throw new Error("Modulus must be greater than 1");
        }

        a = ((a % m) + m) % m;
        let m0 = m;
        let y = 0n;
        let x = 1n;

        while (a > 1n) {
            if (m0 === 0n) {
                throw new Error(`Modular inverse does not exist (not coprime)`);
            }
            const q = a / m0;
            let t = m0;
            m0 = a % m0;
            a = t;
            t = y;
            y = x - q * y;
            x = t;
        }

        if (x < 0n) {
            x += m;
        }

        return {
            input: aInput.toString(),
            modulus: m.toString(),
            inverseDec: x.toString(),
            inverseHex: "0x" + x.toString(16)
        };
    }
}
