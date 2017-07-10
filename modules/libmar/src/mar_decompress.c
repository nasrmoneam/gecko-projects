/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// for ntohl
#ifdef XP_WIN
#include <winsock2.h>
#else
#include <netinet/in.h>
#endif

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include "updatedefines.h"
#include "mar_private.h"
#include "lzma.h"

#define FILE_BUFFER_SIZE 262144
static uint8_t inBuf[FILE_BUFFER_SIZE];
static uint8_t outBuf[FILE_BUFFER_SIZE];

static int
mar_decompress_xz_archive(FILE* from, FILE* to)
{
  lzma_stream strm = LZMA_STREAM_INIT;
  if (lzma_stream_decoder(&strm, UINT64_MAX, 0) != LZMA_OK) {
    return -1;
  }

  strm.next_in = inBuf;
  strm.avail_in = 0;
  strm.next_out = outBuf;
  strm.avail_out = FILE_BUFFER_SIZE;

  int rv = 0, bytesRead = 0;
  lzma_ret xz_rv = LZMA_OK;
  while (xz_rv == LZMA_OK) {
    if (strm.total_in >= strm.avail_in) {
      size_t inlen = fread(inBuf, 1, FILE_BUFFER_SIZE, from);
      if (inlen <= 0) {
        rv = -1;
        break;
      }
      bytesRead += inlen;
      strm.avail_in = inlen;
      strm.total_in = 0;
    }

    strm.total_out = 0;
    xz_rv = lzma_code(&strm, LZMA_RUN);
    if (xz_rv != LZMA_OK && xz_rv != LZMA_STREAM_END) {
      rv = -1;
      break;
    }

    if (strm.total_out != 0) {
      if (fwrite(outBuf, strm.total_out, 1, to) != 1) {
        rv = -1;
        break;
      }
    }
  }

  lzma_end(&strm);
  return rv;
}

static int
mar_is_compressed(FILE* file)
{
  static const char XZ_MAGIC[] = { 0xFD, '7', 'z', 'X', 'Z', 0x00 };
  char buffer[sizeof(XZ_MAGIC)];
  if (fread(buffer, sizeof(XZ_MAGIC), 1, file) != 1) {
    return 0;
  }
  fseek(file, -(int)sizeof(XZ_MAGIC), SEEK_CUR);
  return (memcmp(buffer, XZ_MAGIC, sizeof(XZ_MAGIC)) == 0) ? 1 : 0;
}

int
mar_decompress(MarFile* file)
{
  int contentOffset = 0, contentLength = 0;
  mar_get_content_extent(file, &contentOffset, &contentLength);

  fseek(file->fp, contentOffset, SEEK_SET);

  if (!mar_is_compressed(file->fp)) {
    return 1;
  }

  // Create a temporary archive file.
  NS_tchar extractedPath[MAXPATHLEN] = NS_T("");
  int sprintfLen = NS_tsnprintf(extractedPath, MAXPATHLEN, NS_T("%s.extracted"), file->name);
  // Make sure the path wasn't truncated before opening the file.
  if (sprintfLen != (int)NS_tstrlen(extractedPath)) {
    return -1;
  }
  FILE * extractedFile = NS_tfopen(extractedPath, NS_T("wb+"));
  if (!extractedFile) {
    return -1;
  }

  // Copy from the archive file into the temp file, up to the content area.
  int rv = 0;
  int bytesRead = 0;
  fseek(file->fp, 0, SEEK_SET);
  while (bytesRead < contentOffset) {
    int bytesToRead = FILE_BUFFER_SIZE;
    if ((contentOffset - bytesRead) < FILE_BUFFER_SIZE) {
      bytesToRead = contentOffset - bytesRead;
    }
    if (fread(inBuf, 1, bytesToRead, file->fp) == 0) {
      rv = -1;
      break;
    }
    bytesRead += bytesToRead;
    if (fwrite(outBuf, bytesToRead, 1, extractedFile) != 1) {
      rv = -1;
      break;
    }
  }
  if (rv) {
    fclose(extractedFile);
    NS_tremove(extractedPath);
    return rv;
  }

  // Extract the compressed content into the temp file.
  if (mar_decompress_xz_archive(file->fp, extractedFile) != 0) {
    fclose(extractedFile);
    NS_tremove(extractedPath);
    return -1;
  }

  // Reset the file stream to the end of the content, because the extraction
  // might have read past the end of the actual XZ stream.
  fseek(file->fp, contentOffset + contentLength, SEEK_SET);

  // Copy over the index from the MAR, which is all that's left past the content.
  while (1) {
    size_t bytesRead = fread(inBuf, 1, FILE_BUFFER_SIZE, file->fp);
    if (bytesRead == 0) {
      rv = feof(file->fp) ? 0 : -1;
      break;
    }
    if (fwrite(outBuf, bytesRead, 1, extractedFile) != 1) {
      rv = -1;
      break;
    }
  }
  if (rv) {
    fclose(extractedFile);
    NS_tremove(extractedPath);
    return rv;
  }

  fclose(file->fp);
  file->fp = extractedFile;
  file->decompressed = true;
  return 0;
}

void
mar_decompress_cleanup(MarFile* file)
{
  NS_tchar extractedPath[MAXPATHLEN];
  int sprintfLen =
    NS_tsnprintf(extractedPath, MAXPATHLEN, NS_T("%s.extracted"), file->name);
  // Make sure the path wasn't truncated before removing the file.
  if (sprintfLen == (int)NS_tstrlen(extractedPath)) {
    NS_tremove(extractedPath);
  }
}
