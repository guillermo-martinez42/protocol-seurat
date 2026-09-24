package seurat.observe;

import java.io.PrintStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/** Structured console logger with levels, timestamps, tags, and colors. */
public final class Log {
    private static volatile LogLevel currentLevel = LogLevel.INFO;
    private static volatile PrintStream target = System.out;
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");
    private static final boolean COLOR = (System.console() != null
            || (System.getenv("TERM") != null && !"dumb".equals(System.getenv("TERM"))))
            && System.getenv("NO_COLOR") == null
            && !"false".equalsIgnoreCase(System.getProperty("seurat.log.color"));

    private Log() {}

    public static void setLevel(LogLevel level) {
        if (level != null) {
            currentLevel = level;
        }
    }

    public static LogLevel getLevel() {
        return currentLevel;
    }

    public static void setOutput(PrintStream out) {
        target = out != null ? out : System.out;
    }

    public static boolean isDebugEnabled() {
        return currentLevel.severity <= LogLevel.DEBUG.severity;
    }

    public static boolean isInfoEnabled() {
        return currentLevel.severity <= LogLevel.INFO.severity;
    }

    public static void debug(String tag, String msg) {
        log(LogLevel.DEBUG, tag, msg, null);
    }

    public static void info(String tag, String msg) {
        log(LogLevel.INFO, tag, msg, null);
    }

    public static void warn(String tag, String msg) {
        log(LogLevel.WARN, tag, msg, null);
    }

    public static void warn(String tag, String msg, Throwable t) {
        log(LogLevel.WARN, tag, msg, t);
    }

    public static void error(String tag, String msg) {
        log(LogLevel.ERROR, tag, msg, null);
    }

    public static void error(String tag, String msg, Throwable t) {
        log(LogLevel.ERROR, tag, msg, t);
    }

    private static void log(LogLevel level, String tag, String msg, Throwable t) {
        if (level.severity < currentLevel.severity) {
            return;
        }
        String ts = LocalDateTime.now().format(FMT);
        StringBuilder sb = new StringBuilder(128);
        if (COLOR) {
            sb.append("\u001B[90m").append(ts).append("\u001B[0m ")
              .append(colorFor(level)).append(String.format("%-5s", level.name())).append("\u001B[0m ")
              .append("\u001B[35m[").append(tag).append("]\u001B[0m ")
              .append(msg);
        } else {
            sb.append(ts).append(" ")
              .append(String.format("%-5s", level.name())).append(" ")
              .append("[").append(tag).append("] ")
              .append(msg);
        }
        PrintStream out = target;
        out.println(sb);
        if (t != null) {
            t.printStackTrace(out);
        }
    }

    private static String colorFor(LogLevel level) {
        return switch (level) {
            case DEBUG -> "\u001B[36m";
            case INFO  -> "\u001B[32m";
            case WARN  -> "\u001B[33m";
            case ERROR -> "\u001B[31;1m";
            default    -> "\u001B[0m";
        };
    }
}
