/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Custom config.h used by Mozilla when compiling liblzma */

#if defined(XP_WIN)
// Some of the liblzma files assume that DWORD is defined whenever MSC_VER
// is set, and also that memmove and memcpy can be used without declarations.
// Including windows.h works around this issue.
#include <windows.h>
#endif

#define LZMA_API_STATIC 1
#define HAVE_INTTYPES_H 1
#define HAVE_STDBOOL_H 1
#define HAVE_STRING_H 1
#define HAVE_CHECK_CRC32 1
#define HAVE_CHECK_CRC64 1
#define HAVE_DECODER_LZMA2 1
#define HAVE_ENCODER_LZMA2 1
#define HAVE_MF_BT4 1
#define HAVE_DECODER_X86 1
#define HAVE_ENCODER_X86 1
