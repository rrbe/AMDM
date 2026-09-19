// generate_appcast applies the current release prefix to historical ZIPs too.
export function restoreArchiveReleaseUrls(appcast) {
  return appcast.replace(
    /(\burl=")(https:\/\/github\.com\/rrbe\/AMDM\/releases\/download\/)[^/"\s]+\/(AMDM-([^/"\s]+)-(?:arm64|x64)-mac\.zip)"/g,
    (_, attribute, prefix, archive, version) =>
      `${attribute}${prefix}v${version}/${archive}"`,
  );
}
