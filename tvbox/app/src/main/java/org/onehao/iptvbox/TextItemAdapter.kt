package org.onehao.iptvbox

import android.content.Context
import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.TextView

class TextItemAdapter<T>(
    context: Context,
    items: List<T>,
    private val labelFor: (T) -> String,
) : ArrayAdapter<T>(context, android.R.layout.simple_list_item_1, items.toMutableList()) {
    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
        val view = super.getView(position, convertView, parent) as TextView
        view.text = getItem(position)?.let(labelFor).orEmpty()
        view.setTextColor(Color.WHITE)
        view.textSize = 20f
        view.setPadding(dp(16), dp(14), dp(16), dp(14))
        view.minHeight = dp(64)
        return view
    }

    private fun dp(value: Int): Int {
        return (value * context.resources.displayMetrics.density).toInt()
    }
}
