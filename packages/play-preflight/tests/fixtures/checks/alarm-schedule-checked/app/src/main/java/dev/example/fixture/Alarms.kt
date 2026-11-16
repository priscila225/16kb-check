package dev.example.fixture

import android.app.AlarmManager

fun canUseExact(am: AlarmManager): Boolean = am.canScheduleExactAlarms()
