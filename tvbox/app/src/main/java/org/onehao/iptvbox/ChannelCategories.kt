package org.onehao.iptvbox

const val FAVORITES_CATEGORY_NAME = "我的收藏"
const val LATEST_MOVIES_CATEGORY_NAME = "最新电影"
const val SUSPENSE_CASE_CATEGORY_NAME = "悬案"
private const val VBSKYCN_CATEGORY_NAME = "新加国内源"

fun categorizeChannels(channels: List<Channel>): List<ChannelCategory> {
    val grouped = linkedMapOf<String, MutableList<Channel>>()
    for (channel in channels) {
        grouped.getOrPut(channel.categoryName ?: categoryNameFor(channel.name)) { mutableListOf() } += channel
    }

    val categories = grouped.map { (name, groupedChannels) ->
        ChannelCategory(
            name = name,
            channels = groupedChannels,
            opensListWhenSingle = name == LATEST_MOVIES_CATEGORY_NAME,
        )
    }.sortedWith(compareBy<ChannelCategory> { categoryOrder(it.name) }.thenBy { it.name })
    val favoriteChannels = channels.filter { channel -> channel.isFavorite }

    return listOf(ChannelCategory(name = FAVORITES_CATEGORY_NAME, channels = favoriteChannels)) + categories
}

private fun categoryOrder(name: String): Int {
    return when (name) {
        LATEST_MOVIES_CATEGORY_NAME -> 0
        SUSPENSE_CASE_CATEGORY_NAME -> 1
        VBSKYCN_CATEGORY_NAME -> 2
        else -> 3
    }
}

private fun categoryNameFor(channelName: String): String {
    return when {
        channelName.startsWith("BBC", ignoreCase = true) -> "BBC"
        channelName.startsWith("CCTV", ignoreCase = true) -> "CCTV"
        channelName.startsWith("CGTN", ignoreCase = true) -> "CGTN"
        channelName.startsWith("BRTV", ignoreCase = true) -> "BRTV"
        channelName.contains("卫视") -> "卫视频道"
        else -> channelName.substringBefore(' ').takeIf { it.isNotBlank() } ?: "Other"
    }
}
