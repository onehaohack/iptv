package org.onehao.iptvbox

import android.content.Context

private const val PREFS_NAME = "onehao_iptv_box"
private const val FAVORITES_PREF = "favorite_channel_names"

class FavoriteStore(private val context: Context) {
    fun load(): Set<String> {
        return prefs().getStringSet(FAVORITES_PREF, emptySet()) ?: emptySet()
    }

    fun save(names: Set<String>) {
        prefs()
            .edit()
            .putStringSet(FAVORITES_PREF, names)
            .apply()
    }

    private fun prefs() = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
