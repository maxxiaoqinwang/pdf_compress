type BlobModernReaders = {
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
};

/**
 * Read a Blob without assuming Blob.arrayBuffer() exists.
 *
 * Modern browsers use Blob.arrayBuffer(), while older embedded WebViews and
 * jsdom may only support FileReader. We deliberately do not use
 * Response(blob).arrayBuffer() as a fallback because some DOM implementations
 * serialize the Blob as the literal string "[object Blob]".
 */
export async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  let modernError: unknown;

  try {
    const modernReader = (blob as BlobModernReaders).arrayBuffer;
    if (typeof modernReader === "function") {
      const result = await modernReader.call(blob);
      if (isArrayBuffer(result)) {
        return result;
      }
      modernError = new Error("Blob.arrayBuffer() returned an invalid result.");
    }
  } catch (error) {
    modernError = error;
  }

  try {
    return await readBlobWithFileReader(blob, "array-buffer");
  } catch (fallbackError) {
    throw createBlobReadError("ArrayBuffer", modernError, fallbackError);
  }
}

/**
 * Read text without assuming Blob.text() exists.
 */
export async function readBlobAsText(
  blob: Blob,
  encoding = "utf-8"
): Promise<string> {
  let modernError: unknown;

  try {
    const modernReader = (blob as BlobModernReaders).text;
    if (typeof modernReader === "function") {
      const result = await modernReader.call(blob);
      if (typeof result === "string") {
        return result;
      }
      modernError = new Error("Blob.text() returned an invalid result.");
    }
  } catch (error) {
    modernError = error;
  }

  try {
    return await readBlobWithFileReader(blob, "text", encoding);
  } catch (fallbackError) {
    throw createBlobReadError("text", modernError, fallbackError);
  }
}

function readBlobWithFileReader(
  blob: Blob,
  mode: "array-buffer"
): Promise<ArrayBuffer>;
function readBlobWithFileReader(
  blob: Blob,
  mode: "text",
  encoding?: string
): Promise<string>;
function readBlobWithFileReader(
  blob: Blob,
  mode: "array-buffer" | "text",
  encoding = "utf-8"
): Promise<ArrayBuffer | string> {
  if (typeof FileReader === "undefined") {
    return Promise.reject(
      new Error("This browser does not provide a compatible local-file reader.")
    );
  }

  return new Promise<ArrayBuffer | string>((resolve, reject) => {
    const reader = new FileReader();
    let settled = false;

    const rejectOnce = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(normalizeReadError(error));
    };

    reader.onload = () => {
      if (settled) {
        return;
      }

      const result = reader.result;
      if (mode === "array-buffer" && isArrayBuffer(result)) {
        settled = true;
        resolve(result);
        return;
      }
      if (mode === "text" && typeof result === "string") {
        settled = true;
        resolve(result);
        return;
      }

      rejectOnce(new Error(`FileReader returned an unexpected ${mode} result.`));
    };
    reader.onerror = () => {
      rejectOnce(reader.error ?? new Error("FileReader could not read the Blob."));
    };
    reader.onabort = () => {
      rejectOnce(new Error("Blob reading was aborted."));
    };

    try {
      if (mode === "array-buffer") {
        reader.readAsArrayBuffer(blob);
      } else {
        reader.readAsText(blob, encoding);
      }
    } catch (error) {
      rejectOnce(error);
    }
  });
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function createBlobReadError(
  resultType: string,
  modernError: unknown,
  fallbackError: unknown
): Error {
  const modernDetail = modernError ? ` Modern API error: ${errorMessage(modernError)}.` : "";
  return new Error(
    `Unable to read Blob as ${resultType}.${modernDetail} FileReader error: ${errorMessage(
      fallbackError
    )}.`
  );
}

function normalizeReadError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
