package org.onehao.iptvbox

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.media3.ui.PlayerView

data class MainViews(
    val root: View,
    val playerView: PlayerView,
    val statusView: TextView,
    val categoryListView: ListView,
    val channelListView: ListView,
    val sidePanel: LinearLayout,
    val subPanel: LinearLayout,
    val categoryAdapter: TextItemAdapter<ChannelCategory>,
    val channelAdapter: TextItemAdapter<Channel>,
)

fun createMainViews(
    activity: Activity,
    categories: List<ChannelCategory>,
    visibleChannels: List<Channel>,
    onCategorySelected: (ChannelCategory) -> Unit,
    onChannelSelected: (Int) -> Unit,
    onChannelLongPressed: (Channel) -> Unit,
): MainViews {
    val root = FrameLayout(activity).apply {
        setBackgroundColor(Color.rgb(12, 14, 18))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
    }
    val playerView = PlayerView(activity).apply {
        useController = true
        controllerAutoShow = false
        setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
    }
    val statusView = TextView(activity).apply {
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        textSize = 22f
        setBackgroundColor(Color.argb(150, 0, 0, 0))
        setPadding(activity.dp(24), activity.dp(16), activity.dp(24), activity.dp(16))
    }
    val playbackPanel = FrameLayout(activity).apply {
        setBackgroundColor(Color.BLACK)
        addView(playerView, frameMatchParent())
        addView(statusView, frameCenteredWrapContent())
    }
    val sidePanel = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(activity.dp(24), activity.dp(24), activity.dp(16), activity.dp(24))
        setBackgroundColor(Color.argb(185, 22, 26, 32))
    }
    val categoryAdapter = TextItemAdapter(activity, categories) { category -> "${category.name}  ${category.channels.size}" }
    val categoryListView = ListView(activity).apply {
        adapter = categoryAdapter
        choiceMode = ListView.CHOICE_MODE_SINGLE
        divider = null
        selector = activity.getDrawable(R.drawable.channel_row_selector)
        setBackgroundColor(Color.TRANSPARENT)
        onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ ->
            categoryAdapter.getItem(position)?.let(onCategorySelected)
        }
    }
    val channelAdapter = TextItemAdapter(activity, visibleChannels) { channel ->
        val name = if (channel.isFavorite) "★ ${channel.name}" else channel.name
        if (channel.sources.size > 1) "$name  ${channel.sources.size}源" else name
    }
    val channelListView = ListView(activity).apply {
        adapter = channelAdapter
        choiceMode = ListView.CHOICE_MODE_SINGLE
        divider = null
        selector = activity.getDrawable(R.drawable.channel_row_selector)
        setBackgroundColor(Color.TRANSPARENT)
        onItemClickListener = AdapterView.OnItemClickListener { _, _, position, _ -> onChannelSelected(position) }
        setOnItemLongClickListener { _, _, position, _ ->
            channelAdapter.getItem(position)?.let(onChannelLongPressed)
            true
        }
    }
    val subPanel = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(activity.dp(16), activity.dp(24), activity.dp(16), activity.dp(24))
        setBackgroundColor(Color.argb(165, 10, 12, 16))
        visibility = View.GONE
        addView(channelListView, linearMatchParentWeight())
    }

    sidePanel.addView(TextView(activity).title(activity), linearMatchWidthWrapHeight())
    sidePanel.addView(categoryListView, linearMatchParentWeight())
    root.addView(playbackPanel, frameMatchParent())
    root.addView(sidePanel, FrameLayout.LayoutParams(activity.dp(360), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.START))
    root.addView(
        subPanel,
        FrameLayout.LayoutParams(activity.dp(430), ViewGroup.LayoutParams.MATCH_PARENT, Gravity.START).apply {
            leftMargin = activity.dp(360)
        },
    )

    return MainViews(
        root,
        playerView,
        statusView,
        categoryListView,
        channelListView,
        sidePanel,
        subPanel,
        categoryAdapter,
        channelAdapter,
    )
}

private fun TextView.title(activity: Activity): TextView {
    text = activity.getString(R.string.app_name)
    setTextColor(Color.WHITE)
    textSize = 24f
    typeface = Typeface.DEFAULT_BOLD
    setPadding(0, 0, 0, activity.dp(18))
    return this
}

private fun Activity.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

private fun frameMatchParent(): FrameLayout.LayoutParams {
    return FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
}

private fun frameCenteredWrapContent(): FrameLayout.LayoutParams {
    return FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER,
    )
}

private fun linearMatchWidthWrapHeight(): LinearLayout.LayoutParams {
    return LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
}

private fun linearMatchParentWeight(): LinearLayout.LayoutParams {
    return LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
}
