package org.onehao.iptvbox

data class Channel(
    val name: String,
    val sources: List<String>,
    val categoryName: String? = null,
    val isFavorite: Boolean = false,
)

data class ChannelCategory(
    val name: String,
    val channels: List<Channel>,
    val opensListWhenSingle: Boolean = false,
)
