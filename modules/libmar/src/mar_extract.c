/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include "mar_private.h"
#include "mar.h"
#include "lzma.h"

#ifdef XP_WIN
#include <io.h>
#include <direct.h>
#endif

static lzma_stream strm_decompress = LZMA_STREAM_INIT;

/* Ensure that the directory containing this file exists */
static int mar_ensure_parent_dir(const char *path)
{
  char *slash = strrchr(path, '/');
  if (slash)
  {
    *slash = '\0';
    mar_ensure_parent_dir(path);
#ifdef XP_WIN
    _mkdir(path);
#else
    mkdir(path, 0755);
#endif
    *slash = '/';
  }
  return 0;
}

static int mar_test_callback(MarFile *mar, const MarItem *item, void *unused) {
  FILE *fp;
  int fd, len, offset = 0, rv = -1;

  fprintf(stdout, "Extracting file: %s\n", item->name);

  if (mar_ensure_parent_dir(item->name)) {
    fprintf(stderr, "ERROR: unable to create parent directory in " \
                    "mar_test_callback()\n");
    return rv;
  }

  if (lzma_stream_decoder(&strm_decompress, UINT64_MAX, 0) != LZMA_OK) {
    fprintf(stderr, "ERROR: unable to acquire lzma stream decoder in " \
                    "mar_test_callback()\n");
    return rv;
  }

#ifdef XP_WIN
  fd = _open(item->name, _O_BINARY|_O_CREAT|_O_TRUNC|_O_WRONLY, item->flags);
#else
  fd = creat(item->name, item->flags);
#endif
  if (fd == -1) {
    fprintf(stderr, "ERROR: could not create file in mar_test_callback()\n");
    perror(item->name);
    return rv;
  }

  fp = fdopen(fd, "wb");
  if (!fp) {
    fprintf(stderr, "ERROR: unable to open file in mar_test_callback()\n");
    return rv;
  }

  uint8_t inbuf[BLOCKSIZE], outbuf[BLOCKSIZE];
  lzma_action action = LZMA_RUN;
  strm_decompress.next_in = NULL;
  strm_decompress.avail_in = 0;
  strm_decompress.next_out = outbuf;
  strm_decompress.avail_out = sizeof(outbuf);

  while (true) {
    if (strm_decompress.avail_in == 0) {
      len = mar_read(mar, item, offset, inbuf, sizeof(inbuf));
      if (len > 0) {
        strm_decompress.next_in = inbuf;
        strm_decompress.avail_in = len;
        offset += len;
      } else {

        // Once the end of the input file has been reached,
        // we need to tell lzma_code() that no more input
        // will be coming. As said before, this isn't required
        // if the LZMA_CONATENATED flag isn't used when
        // initializing the decoder.
        action = LZMA_FINISH;
      }
    }

    lzma_ret lzma_rv = lzma_code(&strm_decompress, action);

    if (strm_decompress.avail_out == 0 || lzma_rv == LZMA_STREAM_END) {
      size_t writeBytes = sizeof(outbuf) - strm_decompress.avail_out;
      if (fwrite(outbuf, 1, writeBytes, fp) != writeBytes) {
        fprintf(stderr, "ERROR: error writing file in mar_test_callback()\n");
        break;
      }

      strm_decompress.next_out = outbuf;
      strm_decompress.avail_out = sizeof(outbuf);
    }

    if (lzma_rv != LZMA_OK) {
      // Once everything has been decoded successfully, the
      // return value of lzma_code() will be LZMA_STREAM_END.
      //
      // It is important to check for LZMA_STREAM_END. Do not
      // assume that getting ret != LZMA_OK would mean that
      // everything has gone well or that when you aren't
      // getting more output it must have successfully
      // decoded everything.
      if (lzma_rv == LZMA_STREAM_END) {
        // Success
        rv = 0;
      }
      break;
    }
  }

  fclose(fp);
  return rv;
}

int mar_extract(const char *path) {
  MarFile *mar;
  int rv;

  mar = mar_open(path);
  if (!mar) {
    fprintf(stderr, "ERROR: unable to open mar file in in mar_extract(): %s\n",
            path);
    return -1;
  }

  // Set up an LZMA stream to decompress the file data.
  rv = mar_enum_items(mar, mar_test_callback, NULL);

  lzma_end(&strm_decompress);
  mar_close(mar);
  return rv;
}
