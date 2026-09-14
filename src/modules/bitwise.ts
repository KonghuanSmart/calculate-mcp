import { IntegerConversion } from "./integer.js";

export type BitwiseOp = "and" | "or" | "xor" | "not" | "shl" | "shr" | "sar" | "rol" | "ror";
export type BitWidth = 8 | 16 | 32 | 64;

export interface BitwiseResult {
    operation: string;
    bitWidth: BitWidth;
    operandA: string;
    operandB?: string;
    resultHex: string;
    resultDecSigned: string;
    resultDecUnsigned: string;
    resultBin: string;
}

export class Bitwise {
    /**
     * Executes bitwise operation with specified bit width and operands.
     */
    public static execute(
        op: BitwiseOp,
        aInput: string | number,
        bInput?: string | number,
        width: BitWidth = 32
    ): BitwiseResult {
        const bigWidth = BigInt(width);
        const mask = (1n << bigWidth) - 1n;

        const aRaw = IntegerConversion.parseToBigInt(aInput);
        const a = BigInt.asUintN(width, aRaw);

        let b = 0n;
        if (op !== "not") {
            if (bInput === undefined) {
                throw new Error(`Operation "${op}" requires a second operand.`);
            }
            b = IntegerConversion.parseToBigInt(bInput);
        }

        let resUint: bigint;

        switch (op) {
            case "and":
                resUint = (a & BigInt.asUintN(width, b)) & mask;
                break;
            case "or":
                resUint = (a | BigInt.asUintN(width, b)) & mask;
                break;
            case "xor":
                resUint = (a ^ BigInt.asUintN(width, b)) & mask;
                break;
            case "not":
                resUint = (~a) & mask;
                break;
            case "shl": {
                const shift = b % bigWidth;
                resUint = (a << shift) & mask;
                break;
            }
            case "shr": { // Logical right shift
                const shift = b % bigWidth;
                resUint = (a >> shift) & mask;
                break;
            }
            case "sar": { // Arithmetic right shift
                const signedA = BigInt.asIntN(width, a);
                const shift = b % bigWidth;
                const shiftedSigned = signedA >> shift;
                resUint = BigInt.asUintN(width, shiftedSigned);
                break;
            }
            case "rol": { // Rotate left
                const shift = ((b % bigWidth) + bigWidth) % bigWidth;
                if (shift === 0n) {
                    resUint = a;
                } else {
                    resUint = ((a << shift) | (a >> (bigWidth - shift))) & mask;
                }
                break;
            }
            case "ror": { // Rotate right
                const shift = ((b % bigWidth) + bigWidth) % bigWidth;
                if (shift === 0n) {
                    resUint = a;
                } else {
                    resUint = ((a >> shift) | (a << (bigWidth - shift))) & mask;
                }
                break;
            }
            default:
                throw new Error(`Unsupported bitwise operation: ${op}`);
        }

        const signedRes = BigInt.asIntN(width, resUint);
        const padLen = width / 4;
        const hexStr = "0x" + resUint.toString(16).padStart(padLen, "0");
        const binStr = "0b" + resUint.toString(2).padStart(width, "0");

        return {
            operation: op,
            bitWidth: width,
            operandA: aRaw.toString(),
            operandB: bInput !== undefined ? b.toString() : undefined,
            resultHex: hexStr,
            resultDecSigned: signedRes.toString(),
            resultDecUnsigned: resUint.toString(),
            resultBin: binStr
        };
    }
}
