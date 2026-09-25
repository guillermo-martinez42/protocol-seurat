package seurat.server;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Unpacks image files from a zip archive into an inbox directory. */
final class ZipUnpacker {
    private ZipUnpacker() {}

    static List<Path> unpack(Path zip, java.util.function.Predicate<String> skip) throws Exception {
        Path dir = zip.getParent().resolve(zip.getFileName() + ".d");
        Files.createDirectories(dir);
        List<Path> list = new ArrayList<>();
        try (var in = new ZipFile(zip.toFile())) {
            var entries = in.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String base = Path.of(entry.getName()).getFileName().toString();
                String lower = base.toLowerCase();
                if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".tif")) {
                    continue;
                }
                String workId = base.replaceAll("\\.[^.]+$", "");
                if (skip != null && skip.test(workId)) {
                    continue;
                }
                Path out = dir.resolve(base);
                if (!Files.exists(out) || Files.size(out) != entry.getSize()) {
                    try (var is = in.getInputStream(entry)) {
                        Files.copy(is, out, StandardCopyOption.REPLACE_EXISTING);
                    }
                }
                list.add(out);
            }
        }
        list.sort(Comparator.comparingLong(p -> {
            try { return Files.size(p); } catch (Exception e) { return 0L; }
        }));
        return list;
    }
}
