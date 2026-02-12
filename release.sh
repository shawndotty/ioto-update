#!/bin/bash
set -euo pipefail

# Release script for ioto-update Obsidian plugin
# Usage: ./release.sh [version]
# Example: ./release.sh 2.0.3

VERSION=${1:-}

if [ -z "$VERSION" ]; then
    echo "Usage: ./release.sh <version>"
    echo "Example: ./release.sh 2.0.3"
    exit 1
fi

echo "🚀 Releasing version $VERSION..."

# Ensure we're on a clean working tree
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ Working directory is not clean. Please commit or stash changes first."
    exit 1
fi

# Update version in package.json
npm version "$VERSION" --no-git-tag-version

# Run version bump script (updates manifest.json and versions.json)
npm run version

# Build the project
echo "📦 Building..."
npm run build

# Commit version changes
git add -A
git commit -m "Release v$VERSION"

# Create git tag
git tag -a "v$VERSION" -m "Release $VERSION"


# Create GitHub release with Obsidian plugin files
echo "📝 Creating GitHub release..."
gh release create "v$VERSION" \
    --title "$VERSION" \
    --generate-notes \
    main.js \
    manifest.json \
    styles.css

echo "✅ Release $VERSION complete!"
echo "🔗 https://github.com/shawndotty/ioto-update/releases/tag/$VERSION"
