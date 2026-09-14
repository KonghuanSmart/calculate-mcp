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
            ? Buffer.from(input.replace(/^0x/i, "").replace(/[\s_]/g, ""), "hex")
            : Buffer.from(input, "utf8");

        let b64 = buf.toString("base64");
        if (urlSafe) {
            b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        }
        return b64;
    }

    /**
     * Decodes Base64 to string or hex format.
     */
    public static fromBase64(
        base64Str: string,
        outputFormat: "text" | "hex" = "text"
    ): string {
        let cleanB64 = base64Str.trim().replace(/-/g, "+").replace(/_/g, "/");
        while (cleanB64.length % 4 !== 0) {
            cleanB64 += "=";
        }

        const buf = Buffer.from(cleanB64, "base64");
        return outputFormat === "hex" ? "0x" + buf.toString("hex") : buf.toString("utf8");
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
     * Converts Hex string back to text (UTF-8).
     */
    public static hexToString(hexStr: string): string {
        const clean = hexStr.replace(/^0x/i, "").replace(/[\s_]/g, "");
        const buf = Buffer.from(clean, "hex");
        return buf.toString("utf8");
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
