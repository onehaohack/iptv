package org.onehao.iptvbox

import android.content.Context

private const val PREFS_NAME = "onehao_iptv_box"
private const val PLAYBACK_PROGRESS_PREFIX = "playback_progress:"
private const val PLAYBACK_SOURCE_PREFIX = "playback_source:"
private const val LAST_CHANNEL_PREFIX = "last_channel:"
private const val RESUME_MIN_POSITION_MS = 5_000L

class PlaybackHistory(private val context: Context) {
    fun lastChannelName(category: ChannelCategory): String? {
        return prefs().getString("$LAST_CHANNEL_PREFIX${category.name}", null)
    }

    fun load(channel: Channel): PlaybackProgress? {
        if (!shouldRemember(channel)) return null

        val sourceIndex = prefs().getInt("$PLAYBACK_SOURCE_PREFIX${channel.name}", 0)
            .coerceIn(0, (channel.sources.size - 1).coerceAtLeast(0))
        val positionMs = prefs().getLong("$PLAYBACK_PROGRESS_PREFIX${channel.name}", 0L)
        if (positionMs < RESUME_MIN_POSITION_MS) return null

        return PlaybackProgress(sourceIndex = sourceIndex, positionMs = positionMs)
    }

    fun save(channel: Channel, sourceIndex: Int, positionMs: Long) {
        if (!shouldRemember(channel)) return
        if (positionMs < 0L) return

        val categoryName = channel.categoryName ?: return
        prefs()
            .edit()
            .putInt("$PLAYBACK_SOURCE_PREFIX${channel.name}", sourceIndex)
            .putLong("$PLAYBACK_PROGRESS_PREFIX${channel.name}", positionMs)
            .putString("$LAST_CHANNEL_PREFIX$categoryName", channel.name)
            .apply()
    }

    fun clear(channel: Channel) {
        if (!shouldRemember(channel)) return

        val categoryName = channel.categoryName ?: return
        prefs()
            .edit()
            .remove("$PLAYBACK_SOURCE_PREFIX${channel.name}")
            .remove("$PLAYBACK_PROGRESS_PREFIX${channel.name}")
            .putString("$LAST_CHANNEL_PREFIX$categoryName", channel.name)
            .apply()
    }

    fun shouldRemember(channel: Channel): Boolean {
        return channel.categoryName == LATEST_MOVIES_CATEGORY_NAME ||
            channel.categoryName == XIANGCUN_LOVE_18_CATEGORY_NAME
    }

    private fun prefs() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}

data class PlaybackProgress(
    val sourceIndex: Int,
    val positionMs: Long,
)
