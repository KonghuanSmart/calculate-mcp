# calculate-mcp

[English](README.md) | [简体中文](README_CN.md)

[![npm version](https://img.shields.io/npm/v/calculate-mcp.svg)](https://www.npmjs.com/package/calculate-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Ready-orange.svg)](https://modelcontextprotocol.io)

A comprehensive [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server providing precision numerical calculations, low-level binary data operations, IEEE 754 float decomposition, cryptographic utilities, data codecs, and an intelligent **chained batch execution engine (`batch_calc`)** designed to eliminate multi-turn round-trip overhead for Large Language Models.

---

## 🌟 Highlights

- ⚡ **29 Specialized Tools**: Covers arbitrary-precision integer conversions, bitwise logic, endianness swapping, IEEE 754 floating-point layouts, modular arithmetic, cryptography, statistics, and trigonometry.
- 🔗 **Zero-Round-Trip Chained Execution (`batch_calc`)**: Run multiple operations in a single tool call with step-to-step dependency referencing (`{"$step": 0, "field": "resultHex"}`), reducing LLM latency and token consumption.
- 🔢 **Arbitrary-Precision & Native Bit-Widths**: Powered by native `BigInt` — zero precision loss for 64-bit/128-bit+ integers with full 8/16/32/64-bit signed and unsigned two's complement representations.
- 🛡️ **Zero Bloat**: Built purely with TypeScript, Node.js standard libraries, and Zod. No heavy native bindings or fragile dependencies.

---

## 📦 Installation & Configuration

### 1. Claude Desktop / Cursor / Cline / Pi

Add to your MCP configuration file (e.g. `claude_desktop_config.json` or `mcp.json`):

#### Using `npx` (Recommended):
```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "npx",
      "args": ["-y", "calculate-mcp"]
    }
  }
}
```

#### Using Local Source:
```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "node",
      "args": ["/path/to/calculate-mcp/build/index.js"]
    }
  }
}
```

---

## 🛠️ Tool Catalog (29 Tools)

### 1. Pipeline & Batch Execution (1 Tool)
| Tool | Description |
| :--- | :--- |
| `batch_calc` | Executes multiple calculation steps in a single call. Steps can reference earlier results using `{"$step": index, "field": "..."}`. |

### 2. Number Systems & Binary Data (6 Tools)
| Tool | Description |
| :--- | :--- |
| `int_convert` | Converts integers across Hex, Dec, Bin, Oct, 8/16/32/64-bit signed/unsigned, Little-Endian, and ASCII. Supports batch arrays. |
| `bitwise` | Bitwise operations (`and`, `or`, `xor`, `not`, `shl`, `shr`, `sar`, `rol`, `ror`) with configurable 8/16/32/64-bit width. |
| `endian_swap` | Swaps endianness (Big-Endian <-> Little-Endian) for numbers, hex values, or arbitrary byte streams. |
| `ieee754_convert` | Decomposes Single-precision (Float32) and Double-precision (Float64) IEEE 754 representations (Sign, Exponent, Mantissa, classification). |
| `crypto_calc` | Standard hashes (`md5`, `sha1`, `sha256`), checksums (`crc32`, `crc16-ccitt`, `crc16-modbus`), and BigInt modular math (`mod_pow`, `mod_inverse`, `gcd`). |
| `data_codec` | Encoders and decoders for Base64 (standard & URL-safe), Hex <-> UTF-8 text, and URL encoding/decoding. |

### 3. Basic Arithmetic & Rounding (9 Tools)
| Tool | Description |
| :--- | :--- |
| `add` | Adds two numbers. |
| `subtract` | Subtracts the second number from the first. |
| `multiply` | Multiplies two numbers. |
| `division` | Divides numerator by denominator. |
| `sum` | Computes the sum of an array of numbers. |
| `modulo` | Returns the division remainder. |
| `floor` | Rounds down to the nearest integer. |
| `ceiling` | Rounds up to the nearest integer. |
| `round` | Rounds to the nearest integer. |

### 4. Statistics (5 Tools)
| Tool | Description |
| :--- | :--- |
| `mean` | Calculates the arithmetic mean. |
| `median` | Finds the median value. |
| `mode` | Determines the most frequent entry/entries. |
| `min` | Finds the minimum value. |
| `max` | Finds the maximum value. |

### 5. Trigonometry & Conversions (8 Tools)
| Tool | Description |
| :--- | :--- |
| `sin`, `cos`, `tan` | Sine, cosine, and tangent (in radians). |
| `arcsin`, `arccos`, `arctan` | Inverse trigonometric functions (in radians). |
| `degreesToRadians` | Converts degrees to radians. |
| `radiansToDegrees` | Converts radians to degrees. |

---

## 💡 Practical Examples

### Example 1: Multi-Step Chained Calculation (`batch_calc`)
In a single prompt, decode a packet header, swap endianness, mask flags, and calculate a checksum without round-trip delay:

```json
{
  "steps": [
    { "op": "data_codec", "args": { "action": "from_base64", "input": "c2VjcmV0", "format": "hex" } },
    { "op": "endian_swap", "args": { "value": "0x78563412", "widthBytes": 4 } },
    { "op": "bitwise", "args": { "operation": "xor", "a": { "$step": 1, "field": "bigEndianHex" }, "b": "0xDEADBEEF", "bitWidth": 32 } },
    { "op": "crypto_calc", "args": { "action": "crc32", "data": { "$step": 0, "field": "decoded" }, "inputFormat": "hex" } }
  ]
}
```

### Example 2: Modular Arithmetic & RSA Private Exponent
Solve $d \equiv e^{-1} \pmod{\phi(n)}$ for $e=65537$ and $\phi(n)=10000000000000000051$:

```json
{
  "action": "mod_inverse",
  "a": "65537",
  "modulus": "10000000000000000051"
}
```

### Example 3: IEEE 754 Floating-Point Decomposition
Decompose machine code `0x3f800000` into float components:

```json
{
  "value": "0x3f800000",
  "precision": "float32"
}
```
**Output:**
```json
{
  "value": 1,
  "sign": "+",
  "rawExponentDec": 127,
  "biasedExponent": 0,
  "mantissaHex": "0x000000",
  "type": "normal"
}
```

---

## 💻 Development

```bash
# Clone the repository
git clone https://github.com/<your-username>/calculate-mcp.git
cd calculate-mcp

# Install dependencies
npm install

# Build TypeScript to build/
npm run build

# Run locally in stdio mode
npm start
```

---

## 📄 License

[MIT License](LICENSE) © 2026
