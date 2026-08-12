#pragma once

#include <Arduino.h>

typedef String (*SDFileManagerStatusProvider)();

void beginSDFileManager(bool sdAvailable);
void handleSDFileManager();
bool isSDFileManagerRunning();
void setBibleStatusProvider(SDFileManagerStatusProvider provider);
