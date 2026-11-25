# calculate-mcp

A Model Context Protocol server for the arithmetic and byte-level work a language model should not guess at: exact big-integer math, statistics, bitwise and shift operations at an explicit bit width, endianness swaps, IEEE 754 decomposition, message digests and checksums, modular arithmetic, and Base64/Hex/URL codecs.

It runs over stdio and exposes 29 tools. Every tool answers with either a plain number or a JSON document — never prose — so a client can read the value or parse the structure directly.

## Why a tool instead of mental arithmetic

A model writing `0x7FFE0000 + 0x1A2F0` in its head, or `0.1 + 0.2`, produces something plausible and often wrong. A desktop calculator has the opposite problem: it prints one number and hides the parts that matter for programming work — the 32-bit two's complement view, the byte order, the individual sign/exponent/mantissa fields.

`calculate-mcp` is built for the second kind of question, and it stays exact where a calculator would drift:

- **Integers stay exact at any size.** `add` on `"9007199254740993"` and `1` returns `9007199254740994` — a value that has no exact `double` representation, so plain JavaScript or Python float arithmetic cannot hold it.
- **Bit width is a parameter, not an afterthought.** `bitwise` with `bitWidth: 16`, `a: "0x1234"`, `b: "0xF00F"`, `operation: "xor"` reports `resultHex: "0xe23b"`, `resultDecSigned: "-7621"`, `resultDecUnsigned: "57915"`, and the full binary string in one answer.
- **Bytes are shown, not re-encoded.** Decoding Base64 or Hex returns the raw bytes as hex plus a length, with a text view only when the bytes happen to be printable UTF-8 — binary payloads survive the round trip.
- **Chains run inside one call.** `batch_calc` executes ordered steps and lets a later step read a field of an earlier result, so intermediate values never pass through the model.
- **Failure is a message, not `NaN`.** Division by zero, an unknown bitwise operation, or an oversized key returns a tool error with the accepted values listed.

Typical uses: address and offset arithmetic during reverse engineering, bit masks and register layouts, protocol byte order and checksums, Base64/Hex plumbing, float machine-code inspection, RSA-style modular arithmetic for teaching or verification, and report statistics with a fixed number of decimals.

## Requirements

- Node.js 18 or newer (the server is ESM and needs `BigInt` and the WebCrypto-free Node `crypto` module).
- An MCP client that can launch a stdio server (Claude Desktop, Cursor, Pi, or any SDK-based host).

## Install and connect

### Option A — run from npm with `npx`

Add this to your client's MCP configuration (for Claude Desktop that is `claude_desktop_config.json`, for Cursor `mcp.json`):

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

Nothing needs to be cloned; `npx` downloads the published package on first launch. On Windows, some clients start servers without a shell, so if `npx` is reported as missing, use:

```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "calculate-mcp"]
    }
  }
}
```

### Option B — run from a local checkout

```bash
git clone https://github.com/KonghuanSmart/calculate-mcp.git
cd calculate-mcp
npm install
npm run build
```

Then point the client at the built entry point, using an absolute path:

```json
{
  "mcpServers": {
    "calculate-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/calculate-mcp/build/index.js"]
    }
  }
}
```

On Windows the path may use forward slashes (`"D:/tools/calculate-mcp/build/index.js"`) or escaped backslashes. Restart the client after editing the configuration; the server announces itself on stderr with `MCP Server running in stdio mode` and then waits on stdin.

## How a call and its result look

Every tool takes a single JSON object of named arguments. Successful calls return one text block whose content is either a number (`"4198400"`) or JSON (`{"hex":"0x401000", ...}`) — the shape depends on the tool, and the catalog below names it per tool.

Two failure styles exist and they mean different things:

| What went wrong | What the caller sees |
| :--- | :--- |
| The arguments do not match the schema (missing field, wrong type, empty `numbers` array) | A protocol error: `MCP error -32602: Input validation error: Invalid arguments for tool sin: Expected number, received string at number` |
| The arguments are well-formed but the operation cannot be performed (unknown operation name, zero denominator, wrong AES key length) | A tool result with `isError: true` and the message as text, e.g. `Division by zero: the denominator must not be zero` |

## Tool catalog

### 1. Batch execution (1 tool)

| Tool | Purpose | Parameters | Output |
| :--- | :--- | :--- | :--- |
| `batch_calc` | Runs several operations in one call, with step-to-step references | `steps`: array (min 1) of `{ "op": <tool name>, "args": { ... } }`; `op` must be one of the 28 non-batch tool names | JSON array of `{step, op, status, result \| error \| reason}` |

See [batch_calc in detail](#batch_calc-in-detail) for references, casting, and failure semantics.

### 2. Arithmetic and rounding (9 tools)

| Tool | Purpose | Parameters | Output |
| :--- | :--- | :--- | :--- |
| `add` | `firstNumber + secondNumber` | `firstNumber`, `secondNumber`: number or string (both required) | number text |
| `subtract` | `minuend - subtrahend` | `minuend`, `subtrahend`: number or string (both required) | number text |
| `multiply` | `firstNumber × secondNumber` | `firstNumber`, `secondNumber`: number or string (both required) | number text |
| `division` | `numerator ÷ denominator`; exact integer when both operands are integers and the division is even, otherwise IEEE 754 double division, plus the exact integer quotient and remainder | `numerator`, `denominator`: number or string (both required) | JSON `{value, quotient?, remainder?}` |
| `sum` | Adds every element of a list | `numbers`: array of number or string (min 1) | number text |
| `modulo` | Remainder truncated toward zero, sign follows the numerator | `numerator`, `denominator`: number or string (both required) | number text |
| `floor` | Rounds down to an integer | `number`: number or string | number text |
| `ceiling` | Rounds up to an integer | `number`: number or string | number text |
| `round` | Rounds to the nearest integer with a selectable tie rule | `number`: number or string; `mode`: string, default `"js-round"` — `js-round`, `half-up`, `half-even`, `truncate` | number text |

`division` returns `value` as a string and adds `quotient` / `remainder` only when both operands parse as integers. Two integers that divide evenly give the exact integer in `value`, identical to `quotient`: `"9007199254740993" / 3` returns `value: "3002399751580331"`, `quotient: "3002399751580331"`, `remainder: "0"`. When a remainder is left, `value` is the double approximation and `quotient` / `remainder` carry the exact answer: `1 / 3` returns `value: "0.3333333333333333"`, `quotient: "0"`, `remainder: "1"`.

`round` tie rules: `js-round` sends `x.5` toward `+Infinity` (same as `Math.round`, so `2.5 → 3` and `-2.5 → -2`), `half-up` sends ties away from zero, `half-even` is banker's rounding (`2.5 → 2`, `3.5 → 4`), `truncate` drops the fraction (`-2.7 → -2`).

### 3. Statistics (5 tools)

| Tool | Purpose | Parameters | Output |
| :--- | :--- | :--- | :--- |
| `mean` | Arithmetic mean | `numbers`: array (min 1); `precision`: integer 0–100 (optional, max digits after the point) | number text |
| `median` | Middle value (mean of the two middle values for an even count) | `numbers`: array (min 1); `precision`: integer 0–100 (optional) | number text |
| `mode` | Most frequent value(s) | `numbers`: array (min 1) | JSON array of number strings |
| `min` | Smallest value | `numbers`: array (min 1) | number text |
| `max` | Largest value | `numbers`: array (min 1) | number text |

`mode` answers with every tied value in first-seen order: `[1, 2, 2, 3, 3]` yields `["2", "3"]`. `precision` applies to `mean` and `median` only; integer results are printed without a decimal point even when `precision` is set.

### 4. Trigonometry and angle conversion (8 tools)

| Tool | Purpose | Parameters | Output |
| :--- | :--- | :--- | :--- |
| `sin` / `cos` / `tan` | Sine, cosine, tangent of an angle in radians | `number`: number (required, **number only**) | number text |
| `arcsin` / `arccos` / `arctan` | Inverse functions, result in radians | `number`: number (required) | number text |
| `radiansToDegrees` | Radians → degrees | `number`: number (required) | number text |
| `degreesToRadians` | Degrees → radians | `number`: number (required) | number text |

These eight accept numbers only — passing `"1"` as a string is a schema error, unlike the arithmetic tools. Results are plain `Math.*` doubles, so `sin(3.141592653589793)` is `1.2246467991473532e-16` rather than `0`.

### 5. Integers, bit fields, and bytes (4 tools)

| Tool | Purpose | Parameters | Output |
| :--- | :--- | :--- | :--- |
| `int_convert` | One integer into decimal, hex, binary, octal, 8/16/32/64-bit signed and unsigned views, little-endian hex, and ASCII | `value`: string or number (single); `values`: array of string or number (batch); `compact`: boolean; `fields`: string array of dotted paths | JSON object for one value, JSON array for several |
| `bitwise` | `and`, `or`, `xor`, `not`, `shl`, `shr`, `sar`, `rol`, `ror` at 8/16/32/64 bits | `operation`: string (required); `a`: string or number (required); `b`: string or number (shift count or second operand); `bitWidth`: 8, 16, 32, or 64, default 32 | JSON `{operation, bitWidth, operandA, operandB?, resultHex, resultDecSigned, resultDecUnsigned, resultBin}` |
| `endian_swap` | Reverses byte order of a number, a `0x` hex value, or a byte stream | `value`: string or number (required); `widthBytes`: positive integer (optional; inferred from the value when omitted) | JSON `{input, byteCount, bigEndianHex, littleEndianHex, byteArray, reversedByteArray, hexFormatted}` |
| `ieee754_convert` | Float ↔ IEEE 754 layout in either direction | `value`: number for a decimal float (`3.14159`), or a hex machine word string (`"0x3f800000"` — exactly 8 hex characters for float32, 16 for float64); `precision`: `"float32"`, `"float64"`, or `"both"` (default `"both"`, case-insensitive) | JSON `{input, float32?, float64?}` with the fields listed below |

Details that are easy to get wrong:

- **`int_convert` fields.** Full output carries `input`, `decimal`, `hex`, `hexUpper`, `binary`, `binaryFormatted`, `octal`, `ascii` (only when the value is a printable ASCII code), `twosComplementHex` (only for negative inputs), and `bitWidths.bit8|bit16|bit32|bit64`, each with `unsigned`, `signed`, `hex`, and — from 16 bits up — `littleEndianHex`. The 64-bit `unsigned` and `signed` values are decimal strings because they can exceed `2^53`. `compact: true` keeps `input`, `decimal`, `hex`, `binary`, plus `twosComplementHex` when present; `fields` beats `compact` and accepts dotted paths such as `["decimal", "bitWidths.bit32.hex"]`.
- **`bitwise` masks its operands and wraps its shift counts.** Values are taken modulo `2^bitWidth` before the operation, so `a: "0x1ff"` at `bitWidth: 8` behaves as `0xff`; a shift count is reduced modulo the bit width, so `shl` by `32` at 32 bits leaves the value unchanged and `shl` by `33` shifts by one. `not` takes one operand and ignores `b`; every other operation requires `b` and errors with `Operation "and" requires a second operand.` when it is missing. Result fields are decimal strings for the signed and unsigned views.
- **`endian_swap` input forms.** A `0x`-prefixed string, a space-separated byte stream (`"12 34 56 78"`), a bare hex byte stream of even length (`"0102030405060708"` is eight bytes), or a JS number. A string that is not a pure even-length hex run is parsed as an integer, so `"12345"` is the number 12345 while `"1234"` is two bytes — pass even-length decimal strings as JSON numbers to keep them numeric. `widthBytes` pads or truncates to that length, so `"0x1234"` with `widthBytes: 8` returns `bigEndianHex: "0x0000000000001234"`.
- **`ieee754_convert` layouts.** Each requested precision yields `value` (the number after rounding to that precision, so float32 of `0.1` is `0.10000000149011612`), `hex`, `binary`, `signBit`, `sign`, `rawExponentHex`, `rawExponentDec`, `biasedExponent`, `mantissaHex`, `mantissaFraction`, and `type` (`normal`, `subnormal`, `zero`, `infinity`, or `nan`). A *string* argument is always a hex machine word, never a decimal: `"10"` is rejected because it has 2 hex characters rather than the 8 (float32) or 16 (float64) the precision requires — the error names the expected length instead of zero-extending or truncating. Decimal values must arrive as JSON numbers, and `precision` narrows the accepted length, so `"0x400921fb54442d18"` with `precision: "float32"` fails.

### 6. Cryptography and codecs (2 tools)

| Tool | Purpose | Parameters | Output |
| :--- | :--- | :--- | :--- |
| `crypto_calc` | Digests, HMAC, AES-CBC, CRC32/CRC16, and modular arithmetic behind one `action` switch | `action`: `hash`, `hmac`, `aes_encrypt`, `aes_decrypt`, `crc32`, `crc16`, `mod_pow`, `mod_inverse`, `gcd` (required) plus the per-action fields below | JSON, per action |
| `data_codec` | Base64, Hex, and URL encoding/decoding | `action`: `to_base64`, `from_base64`, `to_hex`, `from_hex`, `url_encode`, `url_decode` (required); `input`: string (required); `format`: `text` or `hex`, default `text`; `urlSafe`: boolean, default false | JSON, per action |

`crypto_calc` in full:

| `action` | Required fields | Optional fields | Result |
| :--- | :--- | :--- | :--- |
| `hash` | `data` | `algorithm` (default `md5`; `md5`, `sha1`, `sha256`, `sha384`, `sha512`), `inputFormat` (`text` / `hex`, default `text`) | `{algorithm, input, hex, base64}` |
| `hmac` | `data`, `key` | `algorithm`, `inputFormat` (applies to `data` **and** `key`) | `{algorithm: "hmac-sha256", key, input, hex, base64}` |
| `aes_encrypt` | `data`, `key`, `iv` | `inputFormat` (for `data`), `keyFormat` (`text` / `hex`, for `key` and `iv`) | `{algorithm: "aes-128-cbc", keyBits, ciphertextHex, ciphertextBase64, length}` |
| `aes_decrypt` | `data`, `key`, `iv` | `inputFormat`, `keyFormat` | `{algorithm, keyBits, hex, length, plaintext?}` |
| `crc32` | `data` | `inputFormat` | `{checksumHex, checksumDec}` |
| `crc16` | `data` | `crcVariant` (`ccitt` or `modbus`, default `modbus`, case-insensitive), `inputFormat` | `{variant, checksumHex, checksumDec}` |
| `mod_pow` | `a` (base), `b` (exponent), `modulus` | — | `{base, exponent, modulus, resultDec, resultHex}` |
| `mod_inverse` | `a`, `modulus` | — | `{input, modulus, inverseDec, inverseHex}` |
| `gcd` | `a`, `b` | — | `{gcdDec, gcdHex}` |

AES keys must be exactly 16, 24, or 32 bytes (`keyFormat: "hex"` counts decoded bytes) and the IV exactly 16 bytes; padding is PKCS#7. `plaintext` appears only when the decrypted bytes are printable UTF-8. The modular actions accept arbitrary-size decimal or `0x` strings and work in `BigInt`, so `"123456789012345678901234567890"` is fine.

`data_codec` in full:

| `action` | Uses `format`? | Result |
| :--- | :--- | :--- |
| `to_base64` | yes — input is text or hex bytes | `{base64}` |
| `from_base64` | no — the result is always the raw byte view | `{hex, length, hexFormatted?, bytes?, decoded?}` |
| `to_hex` | no | `{hex, hexFormatted, length}` |
| `from_hex` | no | `{hex, length, hexFormatted?, bytes?, text?}` |
| `url_encode` | no | `{encoded}` (via `encodeURIComponent`) |
| `url_decode` | no | `{decoded}` |

`hexFormatted` and `bytes` are present for payloads up to 64 bytes. `decoded` (Base64) and `text` (Hex) appear only when every byte forms printable UTF-8; control characters other than tab, LF, and CR suppress them. When `from_base64` is called with `format: "hex"` the result additionally carries `decoded` set to the hex string.

## Numbers: when to pass a number and when to pass a string

JSON numbers are IEEE 754 doubles, so a literal like `9007199254740993` is already `9007199254740992` by the time any server sees it. The tools therefore accept both types and choose the arithmetic path from the value:

| Input | Path | Example |
| :--- | :--- | :--- |
| Integer as string: `"9007199254740993"`, `"0x401000"`, `"-42"`, `"0b1010"` / `"0o77"` (base-conversion tools only) | `BigInt`, exact at any size | `add("9007199254740993", "1")` → `9007199254740994` |
| Fraction as string: `"3/4"`, `"1 / 3"` | division, then double | `add("3/4", "1/4")` → `1` |
| Exponent as string: `"1e3"` | double | `add("1e3", 1)` → `1001` |
| Any JS number, or any string containing `.` or `e` | IEEE 754 double, no correction | `add(0.1, 0.2)` → `0.30000000000000004` |

Rules that follow from this:

1. **Pass integers beyond `Number.MAX_SAFE_INTEGER` as strings.** A `number` argument that is an integer but unsafe is rejected rather than silently rounded: `add` with `firstNumber: 9007199254740993` fails with `Unsafe integer input: 9007199254740992 exceeds Number.MAX_SAFE_INTEGER (9007199254740991) and may already be rounded; pass the intended value as a string (e.g. "9007199254740993")`. The message quotes `...992` because that is what arrived.
2. **Integer operands give integer-exact answers.** `add`, `subtract`, `multiply`, `sum`, `modulo`, `mean`, `median`, `floor`, `ceiling`, `round`, `min`, and `max` keep whole-number inputs in `BigInt`. Mixing in one decimal or exponent value moves the whole operation to doubles.
3. **Base prefixes differ by tool family.** Arithmetic and rounding tools accept decimal, `0x` hex (optionally signed, `"-0x10"`), and fractions — but not `0b` or `0o`, which fail with `Invalid numeric input: "0b1010" (expected a decimal, 0x hex integer, fraction a/b, or signed value)`. `int_convert` is the opposite: it accepts `0x`, `0b`, `0o`, decimal, negatives, and the suffix spellings `"1010b"` (binary), `"1010o"` (octal), `"1010h"` (hex).
4. **Only the eight trigonometry tools insist on a real number.** Everything else in the arithmetic, statistics, and base-conversion families takes `number | string`.
5. **Output is always decimal text.** Integers print in full; floats print as the shortest round-trip decimal (`String(x)`), never in exponent form unless JS itself would use it.

## Option names: every listed value is normalized

Every enumerated field is a free-form string that the server normalizes before matching. The value is trimmed, lowercased, and `-`, `_`, and whitespace are treated as identical — they are dropped outright, so `"SH L"` also reads as `shl`. The name that comes back in the result is always the normalized spelling.

| Field | Accepted spellings | Normalized result |
| :--- | :--- | :--- |
| `bitwise.operation` | `"XOR"`, `"Xor"`, `"xor"` | echoed as `"xor"` |
| `round.mode` | `"HALF-EVEN"`, `"half_even"`, `"HALF EVEN"` | one of `js-round`, `half-up`, `half-even`, `truncate` |
| `crypto_calc.algorithm` | `"SHA-256"`, `"sha_256"`, `"SHA512"` | echoed as `"sha256"`, `"sha512"` |
| `crypto_calc.action` | `"HASH"`, `"Mod_Pow"`, `"aes-encrypt"` | one of `hash`, `hmac`, `aes_encrypt`, `aes_decrypt`, `crc32`, `crc16`, `mod_pow`, `mod_inverse`, `gcd` |
| `crypto_calc.crcVariant` | `"CCITT"`, `"mod-bus"` | `ccitt` or `modbus` |
| `crypto_calc.inputFormat`, `crypto_calc.keyFormat` | `"HEX"`, `"Text"` | `text` or `hex` |
| `data_codec.action` | `"TO_HEX"`, `"toHex"`, `"to-hex"`, `"to_hex"` | one of `to_base64`, `from_base64`, `to_hex`, `from_hex`, `url_encode`, `url_decode` |
| `data_codec.format` | `"HEX"`, `"Text"` | `text` or `hex` |
| `ieee754_convert.precision` | `"FLOAT64"`, `"float_32"` | `float32`, `float64`, or `both` |
| `batch_calc` step `"$cast"` | `"Number"`, `"big_int"`, `"bigint"` | one of `number`, `bigint`, `string` |

Because the accepted spellings are open-ended, these parameters are declared as strings rather than JSON Schema enums; each parameter's description lists its values. An unknown value is a tool error that lists the alternatives, for example `Unknown operation "nand"; expected one of: and, or, xor, not, shl, shr, sar, rol, ror` or `Unknown CRC16 variant "xmodem"; expected one of: ccitt, modbus`.

## batch_calc in detail

`batch_calc` takes `steps`, an ordered array. Steps run in array order; each step is `{"op": "<tool name>", "args": {...}}`, where `args` uses exactly the parameters of that single tool.

```json
{
  "steps": [
    { "op": "int_convert", "args": { "value": "0x401000", "fields": ["decimal", "hex"] } },
    { "op": "add", "args": { "firstNumber": { "$step": 0, "field": "decimal" }, "secondNumber": 16 } },
    { "op": "int_convert", "args": { "value": { "$step": 1 }, "fields": ["hex"] } }
  ]
}
```

### Three reference forms

| Form | Meaning |
| :--- | :--- |
| `{"$step": 0}` | The whole result of step 0. Use it when that step returns a scalar (text number) or when the target parameter is the same JSON shape. |
| `{"$step": 0, "field": "decimal"}` | One field of an object result. Required whenever the referenced step returns an object: `division` gives `{value, quotient, remainder}`, `bitwise` gives `resultHex`, `int_convert` gives `decimal` / `hex` / `binary` / `bitWidths.bit32.hex`, `data_codec` gives `hex` / `base64`. |
| `{"$cast": "bigint", "$step": 0, "field": "decimal"}` | The same reference, converted before use. `number` parses to a JS number, `bigint` returns an exact decimal integer string (also accepts `"0x..."`), `string` serializes non-strings as JSON. |

References may appear anywhere in `args`, including inside arrays, and must point to an earlier step. A reference to the current or a later step aborts the entire call before anything runs:

- Step 0 with `{"$step": 1}` → `Step 0: "$step" cannot be used because there is no earlier step to reference, got 1`
- Step 2 with `{"$step": 5}` → `Step 2: "$step" must reference an earlier step (0 to 1), got 5`

### Automatic coercion

When a referenced value is a numeric string and the target parameter only accepts numbers, the string is converted: `int_convert`'s `decimal` output can feed `sin` or `multiply` without `$cast`. Parameters declared as `number | string` (in `add`, `sum`, `floor`, `round`, `min`, `mode`, `bitwise.a`, …) receive the string unchanged, which is what keeps big integers exact. Use `"$cast": "bigint"` when a downstream tool needs an exact integer and the upstream field is a hex string.

### What happens when a step fails

Each step is validated and executed independently. A failure is recorded, not thrown:

| Outcome | When |
| :--- | :--- |
| `{"step": 0, "op": "add", "status": "ok", "result": "4198416"}` | The step ran. |
| `{"step": 0, "op": "bitwise", "status": "error", "error": "Unknown operation \"bogus\"; expected one of: ..."}` | The step's arguments or logic failed. |
| `{"step": 1, "op": "add", "status": "skipped", "reason": "depends on step 0 which is error"}` | A step this one references did not succeed. |

Steps that do not depend on the failure still run to completion, so one bad operand does not void the batch. Only structural problems — a `$step` pointing forward, a `$step` index outside the array, an `op` outside the allowed list — abort the whole call. A reference to a field that the earlier result does not have (for example `{"$step": 0, "field": "resultHex"}` after an `add`) is a per-step error: `Step 0 result has no field "resultHex"`.

Because the server returns JSON rather than the per-tool text format, `batch_calc` results always need `JSON.parse`, and `result` may itself be a string (`"4198416"`) or an object (`int_convert`, `bitwise`, `division`).

## Examples

Every input and output below was produced by running the built server.

### 1. Chained offset arithmetic in one call

Add 16 to the decimal value of `0x401000` and print the result in hex and binary, without letting the intermediate pass through the caller:

```json
{ "steps": [
  { "op": "int_convert", "args": { "value": "0x401000", "fields": ["decimal", "hex"] } },
  { "op": "add", "args": { "firstNumber": { "$step": 0, "field": "decimal" }, "secondNumber": 16 } },
  { "op": "int_convert", "args": { "value": { "$step": 1 }, "fields": ["hex", "binary"] } }
] }
```

```json
[
  { "step": 0, "op": "int_convert", "status": "ok", "result": { "decimal": "4198400", "hex": "0x401000" } },
  { "step": 1, "op": "add", "status": "ok", "result": "4198416" },
  { "step": 2, "op": "int_convert", "status": "ok", "result": { "hex": "0x401010", "binary": "0b10000000001000000010000" } }
]
```

Step 1 read `decimal` and got the exact integer as a string, which `add` accepted without coercion loss; step 2 fed that number into `int_convert`, whose `value` parameter takes strings or numbers.

### 2. RSA-style modular arithmetic

With the textbook parameters `p = 61`, `q = 53` (so `n = 3233`, `φ(n) = 3120`) and public exponent `e = 17`, the private exponent is the modular inverse of `e`:

```json
{ "action": "mod_inverse", "a": 17, "modulus": 3120 }
```

```json
{
  "input": "17",
  "modulus": "3120",
  "inverseDec": "2753",
  "inverseHex": "0xac1"
}
```

Encrypting the message `42` and decrypting it again:

```json
{ "action": "mod_pow", "a": 42, "b": 17, "modulus": 3233 }
```

```json
{
  "base": "42",
  "exponent": "17",
  "modulus": "3233",
  "resultDec": "2557",
  "resultHex": "0x9fd"
}
```

```json
{ "action": "mod_pow", "a": 2557, "b": 2753, "modulus": 3233 }
```

```json
{
  "base": "2557",
  "exponent": "2753",
  "modulus": "3233",
  "resultDec": "42",
  "resultHex": "0x2a"
}
```

All three calls take arbitrary-size operands, so the same shapes work with real key sizes where intermediate powers would overflow any fixed-width integer.

### 3. Reading a float32 machine word

`0.1` is not representable in binary floating point; asking for the float32 layout shows the store value and every field of the word:

```json
{ "value": 0.1, "precision": "float32" }
```

```json
{
  "input": 0.1,
  "float32": {
    "value": 0.10000000149011612,
    "hex": "0x3dcccccd",
    "binary": "0b00111101110011001100110011001101",
    "signBit": 0,
    "sign": "+",
    "rawExponentHex": "0x7b",
    "rawExponentDec": 123,
    "biasedExponent": -4,
    "mantissaHex": "0x4ccccd",
    "mantissaFraction": 0.6000000238418579,
    "type": "normal"
  }
}
```

The reverse direction uses the same tool with `"value": "0x3dcccccd"`; omit `precision` to get both the float32 and float64 interpretations of a hex word.

## Local development

```bash
npm install
npm run build      # tsc → build/, then chmod +x build/index.js
npm start          # run the compiled server on stdio
npm run stdio      # build, then start
npm test           # vitest over src/
```

The server is a single ESM entry point (`build/index.js`); all tools are generated from the registry in `src/ops.ts`, and `batch_calc` is assembled in `src/index.ts` from that same registry. Adding a tool means adding an entry to `ops.ts` — the single-tool schema, its text formatter, and its `batch_calc` behavior come from that one definition.

## Companion agent skill

`skills/calculate-mcp/SKILL.md` is a Chinese quick-reference for agents: when to call this server, which tool maps to which task, the parameter names that are easy to confuse, and the exact error messages with the fix for each. Install it by copying the folder into the agent's skills directory:

```powershell
# Windows (PowerShell)
Copy-Item -Recurse -Force "skills/calculate-mcp" "$HOME/.agents/skills/"
```

```bash
# Linux / macOS
cp -r skills/calculate-mcp ~/.agents/skills/
```

## License

[MIT](https://github.com/KonghuanSmart/calculate-mcp/blob/main/LICENSE) © 2025 Ethan Henrickosn
