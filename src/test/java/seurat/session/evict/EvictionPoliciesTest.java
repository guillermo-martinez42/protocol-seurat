package seurat.session.evict;

/** JDK-only checks for the factory seam. Run with `java -ea`. */
public final class EvictionPoliciesTest {
    public static void main(String[] args) {
        defaultsToLru();
        rejectsUnknown();
        allowsPluginWithoutCallerChange();
        System.out.println("EvictionPoliciesTest OK");
    }

    private static void defaultsToLru() {
        EvictionPolicy policy = EvictionPolicies.fromName(EvictionConstants.POLICY_LRU);
        check(policy instanceof LruEvictionPolicy, "default must be interim LRU");
    }

    private static void rejectsUnknown() {
        try {
            EvictionPolicies.fromName("nope-clock-v99");
            throw new AssertionError("expected IllegalArgumentException");
        } catch (IllegalArgumentException expected) {
            check(expected.getMessage().contains("nope-clock-v99"), "message must carry name");
        }
    }

    private static void allowsPluginWithoutCallerChange() {
        EvictionPolicy stub = new EvictionPolicy() {
            @Override
            public String name() {
                return "stub-clock";
            }

            @Override
            public java.util.List<EvictionAction> select(
                    java.util.List<EvictionCandidate> leaves,
                    EvictionContext ctx,
                    int needBrushes,
                    int needKib) {
                return java.util.List.of();
            }
        };
        EvictionPolicies.register(stub);
        check(EvictionPolicies.fromName("stub-clock") == stub, "plugin must resolve by name");
    }

    private static void check(boolean cond, String msg) {
        if (!cond) {
            throw new AssertionError(msg);
        }
    }
}
