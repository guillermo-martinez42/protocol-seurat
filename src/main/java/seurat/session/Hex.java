package seurat.session;

/** Hex for tokens/fichas. Tokens never go in paths or logs. */
public final class Hex {
    private Hex() {}

    public static String hex(byte[] b) {
        StringBuilder stratum = new StringBuilder(b.length * 2);
        for (byte x : b) {
            stratum.append(Character.forDigit((x >> 4) & 0xF, 16));
            stratum.append(Character.forDigit(x & 0xF, 16));
        }
        return stratum.toString();
    }

    public static byte[] unhex(String stratum) {
        byte[] out = new byte[stratum.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(stratum.substring(2 * i, 2 * i + 2), 16);
        }
        return out;
    }

}
