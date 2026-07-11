package org.onehao.iptvbox

fun parseM3u(lines: List<String>): List<Channel> {
    val parsedChannels = linkedMapOf<String, MutableList<String>>()
    val categoryNames = linkedMapOf<String, String>()
    val displayNames = linkedMapOf<String, String>()
    var pendingEntry: M3uEntry? = null

    for (rawLine in lines) {
        val line = rawLine.trim()
        when {
            line.startsWith("#EXTINF", ignoreCase = true) -> {
                pendingEntry = parseExtInf(line)
            }

            line.isBlank() || line.startsWith("#") -> Unit

            pendingEntry != null -> {
                val entry = pendingEntry
                val key = entry.groupKey
                if (!displayNames.containsKey(key)) {
                    displayNames[key] = entry.displayName
                }
                if (entry.categoryName != null && !categoryNames.containsKey(key)) {
                    categoryNames[key] = entry.categoryName
                }
                parsedChannels.getOrPut(key) { mutableListOf() } += line
                pendingEntry = null
            }
        }
    }

    return parsedChannels.map { (key, sources) ->
        Channel(
            name = displayNames[key] ?: key,
            sources = sources.distinct(),
            categoryName = categoryNames[key],
        )
    }
}

private fun parseExtInf(line: String): M3uEntry {
    val rawName = line.substringAfter(',', missingDelimiterValue = "Untitled").trim()
    val tvgId = TVG_ID_REGEX.find(line)?.groupValues?.get(1).orEmpty()
    val groupKey = tvgId
        .takeIf { id -> id.contains('.') && id.contains('@') }
        ?.substringBefore('@')
        ?: normalizeChannelName(rawName)
    return M3uEntry(
        categoryName = GROUP_TITLE_REGEX.find(line)?.groupValues?.get(1)?.takeIf { it.isNotBlank() },
        displayName = normalizeChannelName(rawName).takeIf { it.isNotBlank() } ?: "Untitled",
        groupKey = groupKey,
    )
}

private fun normalizeChannelName(name: String): String {
    return name
        .replace(RESOLUTION_SUFFIX_REGEX, "")
        .replace(TAG_SUFFIX_REGEX, "")
        .replace("北京衛視", "BRTV 北京卫视")
        .trim()
}

private data class M3uEntry(
    val categoryName: String?,
    val displayName: String,
    val groupKey: String,
)

private val RESOLUTION_SUFFIX_REGEX = Regex("""\s*\([^)]*\)\s*$""")
private val TAG_SUFFIX_REGEX = Regex("""\s*\[[^]]*]\s*$""")
private val GROUP_TITLE_REGEX = Regex("""group-title="([^"]*)"""")
private val TVG_ID_REGEX = Regex("""tvg-id="([^"]*)"""")
