# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.2.2
### Added
- Add calculations for Bid +1 and Ask -1 on exchanges

### Changes
- Refactored html template block for exchange page.

## 1.2.1
### Changed
- Bugfix on newly added feature

## 1.2.0
### Added
- Calculate max purchasing power on exchange using Bid and Ask prices

## 1.1.9
### Added
- Galleries are marked as download if manual download has been triggered

## 1.1.8
### Changed
- Simplified url matching by splitting up `@include` into multiple `@match` where possible

## 1.1.7
### Changed
- Updated `@include`

## 1.1.6
### Added
- Galleries are now marked immediately when download has started

## 1.1.5
### Changed
- Updated `@include`

## 1.1.4
### Changed
- Wrap download click event to mark gallery as downloaded

## 1.1.3
### Changed
- Typo in code caused gallery to not be downloaded

## 1.1.2
### Removed
- `addGalleryToHistory` call on opening archiver popup
  - Caused galleries to be marked as downloaded before actual download took place

## 1.1.0
### Added
- Auto download gallery if it's free
### Changed
- `@include` updated to include archiver page

## 1.0.2
### Changed
- Use localStorage to keep history of downloads

## 0.1 - Hello world
### Added
- Initial release
- Add download button to galleries on thumbnailview
- Add download button to galleries on listview
- Get metadata from API
- Add cache using indexedDB
