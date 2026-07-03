package org.onehao.iptvbox

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

private const val PLAYLIST_ASSET = "channels_cn_public.m3u"

data class Channel(
    val name: String,
    val url: String,
)

class MainActivity : Activity() {
    private lateinit var player: ExoPlayer
    private lateinit var playerView: PlayerView
    private lateinit var statusView: TextView
    private lateinit var listView: ListView
    private var channels: List<Channel> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        player = ExoPlayer.Builder(this).build()
        channels = loadChannels()

        setContentView(createContentView())
        playerView.player = player
        player.addListener(createPlayerListener())

        if (channels.isEmpty()) {
            showStatus("No channels found in $PLAYLIST_ASSET")
        } else {
            showStatus("Select a channel")
            listView.requestFocus()
        }
    }

    override fun onStop() {
        super.onStop()
        player.pause()
    }

    override fun onDestroy() {
        player.release()
        super.onDestroy()
    }

    private fun createContentView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.rgb(12, 14, 18))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }

        val sidePanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(16), dp(24))
            setBackgroundColor(Color.rgb(22, 26, 32))
        }

        val titleView = TextView(this).apply {
            text = getString(R.string.app_name)
            setTextColor(Color.WHITE)
            textSize = 24f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(18))
        }

        listView = ListView(this).apply {
            adapter = ChannelAdapter()
            choiceMode = ListView.CHOICE_MODE_SINGLE
            divider = null
            selector = getDrawable(R.drawable.channel_row_selector)
            setBackgroundColor(Color.TRANSPARENT)
            onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ ->
                play(channels[position])
            }
        }

        sidePanel.addView(
            titleView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        sidePanel.addView(
            listView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f,
            ),
        )

        val playbackPanel = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }

        playerView = PlayerView(this).apply {
            useController = true
            controllerAutoShow = false
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }

        statusView = TextView(this).apply {
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            textSize = 22f
            setBackgroundColor(Color.argb(150, 0, 0, 0))
            setPadding(dp(24), dp(16), dp(24), dp(16))
        }

        playbackPanel.addView(
            playerView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        playbackPanel.addView(
            statusView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ),
        )

        root.addView(
            sidePanel,
            LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.MATCH_PARENT,
                0.36f,
            ),
        )
        root.addView(
            playbackPanel,
            LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.MATCH_PARENT,
                0.64f,
            ),
        )

        return root
    }

    private fun play(channel: Channel) {
        showStatus("Loading ${channel.name}")
        player.setMediaItem(MediaItem.fromUri(channel.url))
        player.prepare()
        player.playWhenReady = true
    }

    private fun createPlayerListener(): Player.Listener {
        return object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> showStatus("Buffering")
                    Player.STATE_READY -> hideStatus()
                    Player.STATE_ENDED -> showStatus("Stream ended")
                    Player.STATE_IDLE -> Unit
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                showStatus("Playback error: ${error.errorCodeName}")
            }
        }
    }

    private fun loadChannels(): List<Channel> {
        return runCatching {
            assets.open(PLAYLIST_ASSET).bufferedReader().use { reader ->
                parseM3u(reader.readLines())
            }
        }.getOrDefault(emptyList())
    }

    private fun parseM3u(lines: List<String>): List<Channel> {
        val parsedChannels = mutableListOf<Channel>()
        var pendingName: String? = null

        for (rawLine in lines) {
            val line = rawLine.trim()
            when {
                line.startsWith("#EXTINF", ignoreCase = true) -> {
                    pendingName = line.substringAfter(',', missingDelimiterValue = "Untitled").trim()
                }

                line.isBlank() || line.startsWith("#") -> Unit

                pendingName != null -> {
                    parsedChannels += Channel(
                        name = pendingName.takeUnless { it.isNullOrBlank() } ?: line,
                        url = line,
                    )
                    pendingName = null
                }
            }
        }

        return parsedChannels
    }

    private fun showStatus(message: String) {
        statusView.text = message
        statusView.visibility = View.VISIBLE
    }

    private fun hideStatus() {
        statusView.visibility = View.GONE
    }

    private fun dp(value: Int): Int {
        return (value * resources.displayMetrics.density).toInt()
    }

    private inner class ChannelAdapter : ArrayAdapter<Channel>(
        this@MainActivity,
        android.R.layout.simple_list_item_1,
        channels,
    ) {
        override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
            val view = super.getView(position, convertView, parent) as TextView
            view.text = channels[position].name
            view.setTextColor(Color.WHITE)
            view.textSize = 20f
            view.setPadding(dp(16), dp(14), dp(16), dp(14))
            view.minHeight = dp(64)
            return view
        }
    }
}
