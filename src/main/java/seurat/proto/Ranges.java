package seurat.proto;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.TreeSet;

/** SACK ranges (RFC 9000 §19.3.1 wire). largest=0 is the empty set. */
public final class Ranges {
    private final TreeSet<Long> nums;

    private Ranges(TreeSet<Long> nums) {
        this.nums = nums;
    }

    public static Ranges empty() {
        return new Ranges(new TreeSet<>());
    }

    public static Ranges of(long... ns) {
        Builder b = new Builder();
        for (long n : ns) {
            b.add(n);
        }
        return b.build();
    }

    public boolean isEmpty() {
        return nums.isEmpty();
    }

    public boolean contains(long n) {
        return nums.contains(n);
    }

    public long largest() {
        return nums.isEmpty() ? 0 : nums.last();
    }

    public int size() {
        return nums.size();
    }

    public void forEach(java.util.function.LongConsumer f) {
        nums.forEach(v -> f.accept(v));
    }

    public List<long[]> spans() {
        List<long[]> out = new ArrayList<>();
        Long lo = null;
        Long prev = null;
        for (long n : nums) {
            if (lo == null) {
                lo = n;
                prev = n;
            } else if (n == prev + 1) {
                prev = n;
            } else {
                out.add(new long[]{lo, prev});
                lo = n;
                prev = n;
            }
        }
        if (lo != null) {
            out.add(new long[]{lo, prev});
        }
        return out;
    }

    public byte[] encode() {
        if (nums.isEmpty()) {
            return new byte[]{0x00, 0x00, 0x00};
        }
        List<long[]> t = spans();
        Collections.reverse(t);
        ByteBuffer b = ByteBuffer.allocate(8 * (2 * t.size() + 1));
        VarInt.put(b, t.get(0)[1]);
        VarInt.put(b, t.size() - 1);
        VarInt.put(b, t.get(0)[1] - t.get(0)[0]);
        for (int i = 1; i < t.size(); i++) {
            long prevLo = t.get(i - 1)[0];
            long hi = t.get(i)[1];
            long lo = t.get(i)[0];
            VarInt.put(b, prevLo - hi - 2);
            VarInt.put(b, hi - lo);
        }
        byte[] out = new byte[b.position()];
        b.flip();
        b.get(out);
        return out;
    }

    public static Ranges decode(ByteBuffer b) {
        long largest = VarInt.get(b);
        long huecos = VarInt.get(b);
        Builder out = new Builder();
        if (largest == 0) {
            return out.build();
        }
        long first = VarInt.get(b);
        out.addRange(largest - first, largest);
        long menor = largest - first;
        for (long i = 0; i < huecos; i++) {
            long hueco = VarInt.get(b);
            long largo = VarInt.get(b);
            long hi = menor - hueco - 2;
            out.addRange(hi - largo, hi);
            menor = hi - largo;
        }
        return out.build();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Ranges r && nums.equals(r.nums);
    }

    @Override
    public int hashCode() {
        return nums.hashCode();
    }

    /** Builder: add() before build(). */
    public static final class Builder {
        private final TreeSet<Long> acc = new TreeSet<>();

        public Builder add(long n) {
            acc.add(n);
            return this;
        }

        public Builder addRange(long lo, long hi) {
            for (long n = lo; n <= hi; n++) {
                acc.add(n);
            }
            return this;
        }

        public Ranges build() {
            return new Ranges(new TreeSet<>(acc));
        }
    }
}
