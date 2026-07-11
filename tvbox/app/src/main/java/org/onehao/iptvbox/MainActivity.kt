package org.onehao.iptvbox

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

private const val PLAYLIST_ASSET = "channels_all.m3u"
private const val FALLBACK_PLAYLIST_ASSET = "channels_cn_public.m3u"
private const val LOG_TAG = "OnehaoIptv"
private const val PREFS_NAME = "onehao_iptv_box"
private const val FAVORITES_PREF = "favorite_channel_names"
private const val BUFFERING_SOURCE_TIMEOUT_MS = 8_000L
private const val MOVIE_SEEK_STEP_MS = 30_000L

class MainActivity : Activity() {
    private lateinit var player: ExoPlayer
    private lateinit var playerView: PlayerView
    private lateinit var statusView: TextView
    private lateinit var categoryListView: ListView
    private lateinit var channelListView: ListView
    private lateinit var sidePanel: LinearLayout
    private lateinit var subPanel: LinearLayout
    private lateinit var categoryAdapter: TextItemAdapter<ChannelCategory>
    private lateinit var channelAdapter: TextItemAdapter<Channel>
    private var channels: List<Channel> = emptyList()
    private var categories: List<ChannelCategory> = emptyList()
    private var visibleChannels: List<Channel> = emptyList()
    private var favoriteNames: Set<String> = emptySet()
    private var selectedCategoryName = FAVORITES_CATEGORY_NAME
    private var currentChannel: Channel? = null
    private var currentSourceIndex = 0
    private val bufferingHandler = Handler(Looper.getMainLooper())
    private val bufferingTimeout = Runnable { tryNextSourceAfterBufferingTimeout() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        player = ExoPlayer.Builder(this).build()
        favoriteNames = loadFavoriteNames()
        channels = applyFavorites(loadChannels())
        categories = categorizeChannels(channels)
        visibleChannels = categories.firstOrNull()?.channels ?: emptyList()

        val views = createMainViews(
            activity = this,
            categories = categories,
            visibleChannels = visibleChannels,
            onCategorySelected = ::showCategory,
            onChannelSelected = { position -> play(visibleChannels[position]) },
            onChannelLongPressed = ::toggleFavorite,
        )
        playerView = views.playerView
        statusView = views.statusView
        categoryListView = views.categoryListView
        channelListView = views.channelListView
        sidePanel = views.sidePanel
        subPanel = views.subPanel
        categoryAdapter = views.categoryAdapter
        channelAdapter = views.channelAdapter

        setContentView(views.root)
        playerView.player = player
        player.addListener(createPlayerListener())

        if (channels.isEmpty()) {
            showStatus("No channels found in $PLAYLIST_ASSET")
        } else {
            showStatus("Select a channel. Long press a channel to favorite it.")
            categoryListView.requestFocus()
        }
    }

    override fun onStop() {
        super.onStop()
        cancelBufferingTimeout()
        player.pause()
    }

    override fun onDestroy() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        cancelBufferingTimeout()
        player.release()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (
            event.action == KeyEvent.ACTION_DOWN &&
            sidePanel.visibility != View.VISIBLE &&
            handleMovieSeekKey(event.keyCode)
        ) {
            return true
        }

        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && sidePanel.visibility == View.VISIBLE) {
            hideChannelList()
            return true
        }

        if (sidePanel.visibility != View.VISIBLE && keyCode == KeyEvent.KEYCODE_MENU) {
            showChannelList()
            return true
        }

        return super.onKeyDown(keyCode, event)
    }

    private fun showCategory(category: ChannelCategory) {
        selectedCategoryName = category.name
        visibleChannels = category.channels
        channelAdapter.clear()
        channelAdapter.addAll(visibleChannels)
        channelAdapter.notifyDataSetChanged()

        if (visibleChannels.isEmpty()) {
            subPanel.visibility = View.GONE
            showStatus("No favorite channels yet. Long press a channel to favorite it.")
            return
        }

        if (visibleChannels.size == 1 && !category.opensListWhenSingle) {
            subPanel.visibility = View.GONE
            play(visibleChannels.first())
            return
        }

        subPanel.visibility = View.VISIBLE
        channelListView.requestFocus()
    }

    private fun hideChannelList() {
        sidePanel.visibility = View.GONE
        subPanel.visibility = View.GONE
        playerView.requestFocus()
    }

    private fun showChannelList() {
        sidePanel.visibility = View.VISIBLE
        categoryListView.requestFocus()
    }

    private fun handleMovieSeekKey(keyCode: Int): Boolean {
        val channel = currentChannel ?: return false
        if (channel.categoryName != LATEST_MOVIES_CATEGORY_NAME) return false

        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> {
                seekMovieBy(-MOVIE_SEEK_STEP_MS)
                true
            }
            KeyEvent.KEYCODE_DPAD_RIGHT -> {
                seekMovieBy(MOVIE_SEEK_STEP_MS)
                true
            }
            else -> false
        }
    }

    private fun seekMovieBy(deltaMs: Long) {
        val duration = player.duration
        if (!player.isCurrentMediaItemSeekable && duration == C.TIME_UNSET) {
            showStatus("片源加载中，暂不能调进度")
            return
        }

        val currentPosition = player.currentPosition
        val targetPosition = if (duration == C.TIME_UNSET) {
            (currentPosition + deltaMs).coerceAtLeast(0L)
        } else {
            (currentPosition + deltaMs).coerceIn(0L, duration)
        }
        player.seekTo(targetPosition)
        Log.i(LOG_TAG, "Seek ${currentChannel?.name} from $currentPosition to $targetPosition")
        showStatus("进度 ${formatPlaybackTime(targetPosition)}")
    }

    private fun formatPlaybackTime(positionMs: Long): String {
        val totalSeconds = positionMs / 1000
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val seconds = totalSeconds % 60
        return if (hours > 0) {
            "%d:%02d:%02d".format(hours, minutes, seconds)
        } else {
            "%02d:%02d".format(minutes, seconds)
        }
    }

    private fun play(channel: Channel) {
        currentChannel = channel
        currentSourceIndex = 0
        playCurrentSource()
    }

    private fun toggleFavorite(channel: Channel) {
        favoriteNames = if (favoriteNames.contains(channel.name)) {
            favoriteNames - channel.name
        } else {
            favoriteNames + channel.name
        }
        saveFavoriteNames(favoriteNames)
        channels = applyFavorites(channels)
        categories = categorizeChannels(channels)
        refreshCategories()

        val message = if (favoriteNames.contains(channel.name)) {
            "Added ${channel.name} to favorites"
        } else {
            "Removed ${channel.name} from favorites"
        }
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun refreshCategories() {
        categoryAdapter.clear()
        categoryAdapter.addAll(categories)
        categoryAdapter.notifyDataSetChanged()

        val category = categories.firstOrNull { it.name == selectedCategoryName } ?: categories.firstOrNull()
        if (category != null && subPanel.visibility == View.VISIBLE) {
            showCategory(category)
        }
    }

    private fun playCurrentSource() {
        val channel = currentChannel ?: return
        val source = channel.sources.getOrNull(currentSourceIndex) ?: return
        showStatus("Loading ${channel.name} (${currentSourceIndex + 1}/${channel.sources.size})")
        Log.i(LOG_TAG, "Playing ${channel.name} source ${currentSourceIndex + 1}/${channel.sources.size}: $source")
        cancelBufferingTimeout()
        player.setMediaItem(MediaItem.fromUri(source))
        player.prepare()
        player.playWhenReady = true
        scheduleBufferingTimeout()
    }

    private fun tryNextSource(error: PlaybackException): Boolean {
        val channel = currentChannel ?: return false
        val nextSourceIndex = currentSourceIndex + 1
        if (nextSourceIndex >= channel.sources.size) {
            return false
        }

        currentSourceIndex = nextSourceIndex
        showStatus("Source failed: ${error.errorCodeName}. Trying ${currentSourceIndex + 1}/${channel.sources.size}")
        playCurrentSource()
        return true
    }

    private fun tryNextSourceAfterBufferingTimeout() {
        val channel = currentChannel ?: return
        val nextSourceIndex = currentSourceIndex + 1
        if (nextSourceIndex >= channel.sources.size || player.playbackState != Player.STATE_BUFFERING) {
            return
        }

        currentSourceIndex = nextSourceIndex
        showStatus("Buffering too long. Trying ${currentSourceIndex + 1}/${channel.sources.size}")
        Log.i(LOG_TAG, "Buffering timeout for ${channel.name}; trying source ${currentSourceIndex + 1}/${channel.sources.size}")
        playCurrentSource()
    }

    private fun scheduleBufferingTimeout() {
        cancelBufferingTimeout()
        bufferingHandler.postDelayed(bufferingTimeout, BUFFERING_SOURCE_TIMEOUT_MS)
    }

    private fun cancelBufferingTimeout() {
        bufferingHandler.removeCallbacks(bufferingTimeout)
    }

    private fun createPlayerListener(): Player.Listener {
        return object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> {
                        showStatus("Buffering")
                        scheduleBufferingTimeout()
                    }
                    Player.STATE_READY -> {
                        cancelBufferingTimeout()
                        hideStatus()
                    }
                    Player.STATE_ENDED -> showStatus("Stream ended")
                    Player.STATE_IDLE -> cancelBufferingTimeout()
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                cancelBufferingTimeout()
                if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                    showStatus("Refreshing live stream")
                    player.seekToDefaultPosition()
                    player.prepare()
                    player.playWhenReady = true
                    return
                }

                if (!tryNextSource(error)) {
                    showStatus("Playback error: ${error.errorCodeName}")
                }
            }
        }
    }

    private fun loadChannels(): List<Channel> {
        val primaryChannels = loadChannelsFromAsset(PLAYLIST_ASSET)
        if (primaryChannels.isNotEmpty()) {
            return primaryChannels
        }

        return loadChannelsFromAsset(FALLBACK_PLAYLIST_ASSET)
    }

    private fun applyFavorites(sourceChannels: List<Channel>): List<Channel> {
        return sourceChannels.map { channel ->
            channel.copy(isFavorite = favoriteNames.contains(channel.name))
        }
    }

    private fun loadFavoriteNames(): Set<String> {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getStringSet(FAVORITES_PREF, emptySet()) ?: emptySet()
    }

    private fun saveFavoriteNames(names: Set<String>) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putStringSet(FAVORITES_PREF, names)
            .apply()
    }

    private fun loadChannelsFromAsset(assetName: String): List<Channel> {
        return runCatching {
            assets.open(assetName).bufferedReader().use { reader ->
                val lines = reader.readLines()
                val parsedChannels = parseM3u(lines)
                Log.i(LOG_TAG, "Loaded $assetName: ${lines.size} lines, ${parsedChannels.size} channels")
                parsedChannels
            }
        }.getOrElse { error ->
            Log.e(LOG_TAG, "Failed to load $assetName. Available assets=${assets.list("")?.joinToString()}", error)
            emptyList()
        }
    }

    private fun showStatus(message: String) {
        statusView.text = message
        statusView.visibility = View.VISIBLE
    }

    private fun hideStatus() {
        statusView.visibility = View.GONE
    }

}
