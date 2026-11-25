const MAX_INLINE_BYTES = 64;

export interface ByteView {
    hex: string;
    length: number;
    hexFormatted?: string;
    bytes?: number[];
    decoded?: string;
}

export function decodeHexBytes(hexStr: string): Buffer {
    const clean = hexStr.replace(/^0x/i, "").replace(/[\s_:]/g, "");
    if (clean === "") {
        return Buffer.alloc(0);
    }
    if (!/^[0-9a-fA-F]+$/.test(clean)) {
        throw new Error(`Invalid hex input: "${hexStr}" contains non-hexadecimal characters`);
    }
    if (clean.length % 2 !== 0) {
        throw new Error(`Invalid hex input: "${hexStr}" has an odd number of digits (${clean.length})`);
    }
    return Buffer.from(clean, "hex");
}

export function decodeBase64Bytes(base64Str: string): Buffer {
    let clean = base64Str.trim().replace(/-/g, "+").replace(/_/g, "/");
    while (clean.length % 4 !== 0) {
        clean += "=";
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
        throw new Error(`Invalid Base64 input: "${base64Str}" contains characters outside the Base64 alphabet`);
    }
    return Buffer.from(clean, "base64");
}

function printableUtf8(buf: Buffer): string | undefined {
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
        return undefined;
    }
    for (const char of text) {
        const code = char.codePointAt(0) as number;
        const isControl = (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f;
        if (isControl) {
            return undefined;
        }
    }
    return text;
}

export class DataCodec {
    /**
     * Encodes string or hex bytes to Base64 (standard or url-safe).
     */
    public static toBase64(
        input: string,
        inputFormat: "text" | "hex" = "text",
        urlSafe: boolean = false
    ): string {
        const buf = inputFormat === "hex"
            ? decodeHexBytes(input)
            : Buffer.from(input, "utf8");

        let b64 = buf.toString("base64");
        if (urlSafe) {
            b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        }
        return b64;
    }

    /**
     * Decodes Base64 bytes without any character-set interpretation.
     */
    public static fromBase64(base64Str: string): Buffer {
        return decodeBase64Bytes(base64Str);
    }

    public static describeBytes(buf: Buffer): ByteView {
        const view: ByteView = {
            hex: "0x" + buf.toString("hex"),
            length: buf.length
        };
        if (buf.length <= MAX_INLINE_BYTES) {
            view.hexFormatted = Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" ");
            view.bytes = Array.from(buf);
        }
        const text = printableUtf8(buf);
        if (text !== undefined) {
            view.decoded = text;
        }
        return view;
    }

    /**
     * Converts string to Hex representation.
     */
    public static stringToHex(str: string): { hex: string; hexFormatted: string; length: number } {
        const buf = Buffer.from(str, "utf8");
        const hex = buf.toString("hex");
        const hexFormatted = Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" ");
        return {
            hex: "0x" + hex,
            hexFormatted,
            length: buf.length
        };
    }

    /**
     * Converts a Hex string to raw bytes.
     */
    public static hexToBuffer(hexStr: string): Buffer {
        return decodeHexBytes(hexStr);
    }

    /**
     * Encodes URI component.
     */
    public static urlEncode(text: string): string {
        return encodeURIComponent(text);
    }

    /**
     * Decodes URI component.
     */
    public static urlDecode(encodedText: string): string {
        return decodeURIComponent(encodedText);
    }
}
