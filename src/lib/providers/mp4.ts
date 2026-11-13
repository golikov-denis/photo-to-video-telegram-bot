import { DownloadError } from "../http";

export function validateMp4(bytes: Buffer): void {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new DownloadError("Provider result is not an MP4 file.");
  }
}
