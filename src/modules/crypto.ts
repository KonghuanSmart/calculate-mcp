import * as crypto from "crypto";
import { IntegerConversion } from "./integer.js";
import { decodeHexBytes } from "./codec.js";

export const HASH_ALGORITHMS = ["md5", "sha1", "sha256", "sha384", "sha512"] as const;

export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

export function normalizeAlgorithm(value: string): string {
    return value.trim().toLowerCase().replace(/[-_\s]/g, "");
}

export function isHashAlgorithm(value: string): value is HashAlgorithm {
    return (HASH_ALGORITHMS as readonly string[]).includes(value);
}

export function parseHashAlgorithm(value: string): HashAlgorithm {
    const normalized = normalizeAlgorithm(value);
    if (isHashAlgorithm(normalized)) {
        return normalized;
    }
    throw new Error(`Unknown algorithm "${value}"; expected one of: ${HASH_ALGORITHMS.join(", ")}`);
}

function toBuffer(value: string, inputFormat: "text" | "hex"): Buffer {
    return inputFormat === "hex" ? decodeHexBytes(value) : Buffer.from(value, "utf8");
}

function cipherNameFor(key: Buffer): { algorithm: string; keyBits: number } {
    switch (key.length) {
        case 16:
            return { algorithm: "aes-128-cbc", keyBits: 128 };
        case 24:
            return { algorithm: "aes-192-cbc", keyBits: 192 };
        case 32:
            return { algorithm: "aes-256-cbc", keyBits: 256 };
        default:
            throw new Error(`Invalid AES key length: ${key.length} bytes (${key.length * 8} bits); expected 16, 24, or 32 bytes for AES-128/192/256`);
    }
}

export interface AesEncryptResult {
    algorithm: string;
    keyBits: number;
    ciphertextHex: string;
    ciphertextBase64: string;
    length: number;
}

export interface AesDecryptResult {
    algorithm: string;
    keyBits: number;
    hex: string;
    length: number;
    plaintext?: string;
}

export class CryptoCalc {
    /**
     * Calculates a hash (MD5, SHA-1, SHA-256, SHA-384, SHA-512) of text or hex buffer.
     */
    public static hash(
        algorithm: HashAlgorithm,
        data: string,
        inputFormat: "text" | "hex" = "text"
    ): { algorithm: string; input: string; hex: string; base64: string } {
        const buf = toBuffer(data, inputFormat);

        const h = crypto.createHash(algorithm).update(buf);
        return {
            algorithm,
            input: data,
            hex: h.copy().digest("hex"),
            base64: h.digest("base64")
        };
    }

    public static hmac(
        algorithm: HashAlgorithm,
        key: string,
        data: string,
        inputFormat: "text" | "hex" = "text"
    ): { algorithm: string; key: string; input: string; hex: string; base64: string } {
        const keyBuf = toBuffer(key, inputFormat);
        const dataBuf = toBuffer(data, inputFormat);

        const h = crypto.createHmac(algorithm, keyBuf).update(dataBuf);
        const hex = h.digest("hex");
        return {
            algorithm: `hmac-${algorithm}`,
            key,
            input: data,
            hex,
            base64: Buffer.from(hex, "hex").toString("base64")
        };
    }

    public static aesEncrypt(
        key: string,
        iv: string,
        data: string,
        inputFormat: "text" | "hex" = "text",
        keyFormat: "text" | "hex" = "text"
    ): AesEncryptResult {
        const keyBuf = toBuffer(key, keyFormat);
        const ivBuf = toBuffer(iv, keyFormat);
        const { algorithm, keyBits } = cipherNameFor(keyBuf);
        if (ivBuf.length !== 16) {
            throw new Error(`Invalid AES IV length: ${ivBuf.length} bytes; AES-CBC requires a 16-byte IV`);
        }

        const cipher = crypto.createCipheriv(algorithm, keyBuf, ivBuf);
        const out = Buffer.concat([cipher.update(toBuffer(data, inputFormat)), cipher.final()]);
        return {
            algorithm,
            keyBits,
            ciphertextHex: "0x" + out.toString("hex"),
            ciphertextBase64: out.toString("base64"),
            length: out.length
        };
    }

    public static aesDecrypt(
        key: string,
        iv: string,
        data: string,
        inputFormat: "text" | "hex" = "text",
        keyFormat: "text" | "hex" = "text"
    ): AesDecryptResult {
        const keyBuf = toBuffer(key, keyFormat);
        const ivBuf = toBuffer(iv, keyFormat);
        const { algorithm, keyBits } = cipherNameFor(keyBuf);
        if (ivBuf.length !== 16) {
            throw new Error(`Invalid AES IV length: ${ivBuf.length} bytes; AES-CBC requires a 16-byte IV`);
        }

        const payload = toBuffer(data, inputFormat);
        const decipher = crypto.createDecipheriv(algorithm, keyBuf, ivBuf);
        let out: Buffer;
        try {
            out = Buffer.concat([decipher.update(payload), decipher.final()]);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`AES decryption failed: wrong key/IV or corrupted ciphertext (PKCS#7 padding check failed); ${reason}`);
        }
        const text = new TextDecoder("utf-8", { fatal: true });
        const result: AesDecryptResult = {
            algorithm,
            keyBits,
            hex: "0x" + out.toString("hex"),
            length: out.length
        };
        try {
            result.plaintext = text.decode(out);
        } catch {
            delete result.plaintext;
        }
        return result;
    }

    /**
     * Calculates standard IEEE 802.3 CRC32 checksum.
     */
    public static crc32(data: string, inputFormat: "text" | "hex" = "text"): {
        checksumHex: string;
        checksumDec: number;
    } {
        const buf = toBuffer(data, inputFormat);

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
        const buf = toBuffer(data, inputFormat);

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
