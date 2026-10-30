// Tilemaps: level1, level-2, level-3 (53 x 20)
// Image: KNIGHTSPRITE
// Animations: skellyWalkLeft, skellyWalkRight,
// skellyAttackLeft, skellyAttackRight,
// forestBatLeft, forestBatRight,
// forestBatAttackLeft, forestBatAttackRight,
// heart, drop, laser, explosion
// Images: forestLargeMushroom1, forestLargeMushroom0,
// forestMushroomPatch, pedestal, vine, coin0, potion10
// Tiles: stairLadder, collectibleBlueCrystal,
// collectibleInsignia, collectibleRedCrystal,
// transparency16, TILEDOWN, SWORDCHEST, OPEN CHEST, hazardLava1
// Extensions: Status Bars, Controller

const HERO_SPEED = 75
const CLIMB_SPEED = 48
const JUMP_SPEED = -170
const GRAVITY = 400
const ENEMY_SPEED = 28
const ENEMY_HEALTH = 3
const HERO_HEALTH = 5
const ENEMY_SCORE = 100

const MAP_COLUMNS = 53
const MAP_ROWS = 20

const LEVEL1_START_COL = 50
const LEVEL1_START_ROW = 15
const LEVEL2_START_COL = 50
const LEVEL2_START_ROW = 18
const LEVEL3_START_COL = 3
const LEVEL3_START_ROW = 18

const LEVEL1_PRINCESS_COL = 2
const LEVEL1_PRINCESS_ROW = 4
const LEVEL2_PRINCESS_COL = 49
const LEVEL2_PRINCESS_ROW = 4
const LEVEL3_PRINCESS_COL = 49
const LEVEL3_PRINCESS_ROW = 8


namespace SpriteKind {
    export const Climbable = SpriteKind.create()
    export const Skeleton = SpriteKind.create()
    export const Bat = SpriteKind.create()
    export const Coin = SpriteKind.create()
    export const Potion = SpriteKind.create()
    export const Princess = SpriteKind.create()
    export const Heart = SpriteKind.create()
    export const Warning = SpriteKind.create()
    export const Hazard = SpriteKind.create()
    export const IntroOverlay = SpriteKind.create()
}

enum GameAction {
    WalkLeft,
    WalkRight,
    AttackLeft,
    AttackRight
}

enum MarkerType {
    None,
    Climbable,
    Enemy,
    Item
}

enum GameMode {
    Intro,
    Playing,
    WaitingForLevel2,
    WaitingForLevel3,
    Ending
}

let hero: Sprite = null
let princess: Sprite = null
let healthBar: StatusBarSprite = null

let climbables: Sprite[] = []
let enemies: Sprite[] = []
let enemyHealthBars: StatusBarSprite[] = []
let stageSprites: Sprite[] = []

let levelNumber = 1
let mode = GameMode.Playing
let gameStarted = false
let climbing = false
let standingOnClimbable = false
let jumpingOffClimbable = false
let previousHeroBottom = 0
let dropThroughPlatform: Sprite = null
let attacking = false
let facingRight = true
let hitCooldown = false
let hasSword = false
let hazardActive = false
let stageGeneration = 0

let coinsCollected = 0
let enemiesDefeated = 0
let deathsThisRun = 0
let startTime = 0
let introUntil = 0
let introOverlay: Sprite
let introOverlayActive = false
let promptedChestCol = -1
let promptedChestRow = -1
let chestPromptUntil = 0
const DEATH_SCORE_PENALTY = 250

function clampNumber(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(high, value))
}

function trackStageSprite(sprite: Sprite): Sprite {
    stageSprites.push(sprite)
    return sprite
}

function destroyStageSprite(sprite: Sprite) {
    if (!sprite) return

    let index = stageSprites.indexOf(sprite)
    if (index >= 0) {
        stageSprites[index] = null
    }

    sprite.destroy()
}

function clearStageSprites() {
    for (let bar of enemyHealthBars) {
        if (bar) {
            bar.destroy()
        }
    }

    let oldStageSprites = stageSprites
    stageSprites = []

    for (let sprite of oldStageSprites) {
        if (sprite) {
            sprite.destroy()
        }
    }
    enemies = []
    enemyHealthBars = []
    climbables = []
    dropThroughPlatform = null
    princess = null
}

function tileCenterX(col: number): number {
    return tiles.getTileLocation(col, 0).x
}

function tileBottomY(row: number): number {
    return tiles.getTileLocation(0, row).bottom
}

function placeAtTileBottom(sprite: Sprite, col: number, row: number) {
    placeSpriteBottomAt(sprite, tileCenterX(col), tileBottomY(row))
}

function placeSpriteBottomAt(sprite: Sprite, x: number, bottomY: number) {
    sprite.setPosition(x, bottomY - sprite.height / 2)
}

function markerImageScore(actual: Image, expected: Image): number {
    if (!actual || !expected) return -1
    if (actual.width != expected.width || actual.height != expected.height) return -1

    let shapeMatches = 0
    let foregroundMatches = 0
    let foregroundSamples = 0
    let samples = 0
    let actualBackground = actual.getPixel(0, 0)
    let expectedBackground = expected.getPixel(0, 0)

    for (let sampleY = 0; sampleY < 8; sampleY++) {
        for (let sampleX = 0; sampleX < 8; sampleX++) {
            let x = Math.floor(sampleX * actual.width / 8)
            let y = Math.floor(sampleY * actual.height / 8)
            let actualPixel = actual.getPixel(x, y)
            let expectedPixel = expected.getPixel(x, y)

            if ((actualPixel == actualBackground) == (expectedPixel == expectedBackground)) {
                shapeMatches += 1
            }
            if (expectedPixel != expectedBackground) {
                foregroundSamples += 1
                if (actualPixel == expectedPixel) foregroundMatches += 1
            }
            samples += 1
        }
    }

    if (foregroundSamples == 0) return -1

    let shapeRatio = shapeMatches / samples
    let colorRatio = foregroundMatches / foregroundSamples
    return shapeRatio * 0.35 + colorRatio * 0.65
}

function markerTypeAtLocation(location: tiles.Location): MarkerType {
    let blue = assets.tile`collectibleBlueCrystal`
    let red = assets.tile`collectibleRedCrystal`
    let insignia = assets.tile`collectibleInsignia`

    if (tiles.tileAtLocationEquals(location, blue)) return MarkerType.Climbable
    if (tiles.tileAtLocationEquals(location, red)) return MarkerType.Item
    if (tiles.tileAtLocationEquals(location, insignia)) return MarkerType.Enemy

    let actual = tiles.tileImageAtLocation(location)
    let blueScore = markerImageScore(actual, blue)
    let redScore = markerImageScore(actual, red)
    let enemyScore = markerImageScore(actual, insignia)

    let bestScore = blueScore
    let bestType = MarkerType.Climbable
    let secondScore = Math.max(redScore, enemyScore)

    if (redScore > bestScore) {
        secondScore = Math.max(bestScore, enemyScore)
        bestScore = redScore
        bestType = MarkerType.Item
    }
    if (enemyScore > bestScore) {
        secondScore = Math.max(bestScore, redScore)
        bestScore = enemyScore
        bestType = MarkerType.Enemy
    }

    if (bestScore < 0.48 || bestScore - secondScore < 0.08) {
        return MarkerType.None
    }

    return bestType
}

function markerLocations(markerType: MarkerType): tiles.Location[] {
    let locations: tiles.Location[] = []

    for (let row = 0; row < MAP_ROWS; row++) {
        for (let col = 0; col < MAP_COLUMNS; col++) {
            let location = tiles.getTileLocation(col, row)
            if (markerTypeAtLocation(location) == markerType) {
                locations.push(location)
            }
        }
    }

    return locations
}
function clearMarker(location: tiles.Location) {
    tiles.setWallAt(location, false)
    tiles.setTileAt(location, assets.tile`transparency16`)
}

function clearLadderWalls() {
    for (let row = 0; row < MAP_ROWS; row++) {
        for (let col = 0; col < MAP_COLUMNS; col++) {
            let location = tiles.getTileLocation(col, row)

            if (
                tiles.tileAtLocationEquals(location, assets.tile`stairLadder`) ||
                tiles.tileAtLocationEquals(location, sprites.dungeon.stairLadder) ||
                tiles.tileAtLocationEquals(location, sprites.dungeon.stairNorth)
            ) {
                tiles.setWallAt(location, false)
            }
        }
    }
}

function setEnemyAction(enemy: Sprite, action: GameAction) {
    if (sprites.readDataNumber(enemy, "action") == action) {
        return
    }

    sprites.setDataNumber(enemy, "action", action)

    let frames: Image[]
    let looping = true

    if (enemy.kind() == SpriteKind.Skeleton) {
        if (action == GameAction.WalkLeft) {
            frames = assets.animation`skellyWalkLeft`
        } else if (action == GameAction.WalkRight) {
            frames = assets.animation`skellyWalkRight`
        } else if (action == GameAction.AttackLeft) {
            frames = assets.animation`skellyAttackLeft`
            looping = false
        } else {
            frames = assets.animation`skellyAttackRight`
            looping = false
        }
    } else {
        if (action == GameAction.WalkLeft) {
            frames = assets.animation`forestBatLeft`
        } else if (action == GameAction.WalkRight) {
            frames = assets.animation`forestBatRight`
        } else if (action == GameAction.AttackLeft) {
            frames = assets.animation`forestBatAttackLeft`
            looping = false
        } else {
            frames = assets.animation`forestBatAttackRight`
            looping = false
        }
    }

    animation.runImageAnimation(enemy, frames, 120, looping)
}

function attachEnemyHealthBar(enemy: Sprite) {
    let bar = statusbars.create(18, 3, StatusBarKind.Health)
    bar.attachToSprite(enemy, 0, -10)
    bar.max = ENEMY_HEALTH
    bar.value = ENEMY_HEALTH
    enemyHealthBars.push(bar)
}

function addSkeletonAt(location: tiles.Location) {
    let frames = assets.animation`skellyWalkLeft`
    let skeleton = trackStageSprite(
        sprites.create(frames[0], SpriteKind.Skeleton)
    )

    placeSpriteBottomAt(skeleton, location.x, location.bottom)
    skeleton.ay = GRAVITY
    skeleton.vx = ENEMY_SPEED

    sprites.setDataNumber(skeleton, "minX", 8)
    sprites.setDataNumber(
        skeleton,
        "maxX",
        tiles.getTileLocation(MAP_COLUMNS - 1, 0).x
    )
    sprites.setDataNumber(skeleton, "speed", ENEMY_SPEED)
    sprites.setDataNumber(skeleton, "action", -1)
    sprites.setDataNumber(skeleton, "attackUntil", 0)
    sprites.setDataNumber(skeleton, "attackingUntil", 0)
    sprites.setDataNumber(skeleton, "hp", ENEMY_HEALTH)
    sprites.setDataNumber(skeleton, "hurtUntil", 0)

    attachEnemyHealthBar(skeleton)
    setEnemyAction(skeleton, GameAction.WalkRight)
    enemies.push(skeleton)
}

function addBatAt(location: tiles.Location) {
    let frames = assets.animation`forestBatLeft`
    let bat = trackStageSprite(
        sprites.create(frames[0], SpriteKind.Bat)
    )

    bat.setPosition(location.x, location.y)
    bat.setFlag(SpriteFlag.GhostThroughWalls, true)

    sprites.setDataNumber(bat, "minX", 8)
    sprites.setDataNumber(
        bat,
        "maxX",
        tiles.getTileLocation(MAP_COLUMNS - 1, 0).x
    )
    sprites.setDataNumber(bat, "minY", 8)
    sprites.setDataNumber(
        bat,
        "maxY",
        tiles.getTileLocation(0, MAP_ROWS - 1).y
    )
    sprites.setDataNumber(bat, "speed", ENEMY_SPEED)
    sprites.setDataNumber(bat, "action", -1)
    sprites.setDataNumber(bat, "attackUntil", 0)
    sprites.setDataNumber(bat, "attackingUntil", 0)
    sprites.setDataNumber(bat, "hp", ENEMY_HEALTH)
    sprites.setDataNumber(bat, "hurtUntil", 0)

    attachEnemyHealthBar(bat)
    bat.vx = ENEMY_SPEED
    bat.vy = ENEMY_SPEED
    setEnemyAction(bat, GameAction.WalkRight)
    enemies.push(bat)
}

function placeHeroAt(startCol: number, startRow: number) {
    standingOnClimbable = false
    jumpingOffClimbable = false
    dropThroughPlatform = null
    hero.scale = 0.2
    hero.vx = 0
    hero.vy = 0
    hero.setFlag(SpriteFlag.GhostThroughWalls, false)
    climbing = false

    let foundFloor = false

    for (let radius = 0; radius <= 3 && !foundFloor; radius++) {
        for (let side = -1; side <= 1 && !foundFloor; side += 2) {
            let col = radius == 0 ? startCol : startCol + radius * side

            if (col < 0 || col >= MAP_COLUMNS) continue

            for (let row = startRow; row < MAP_ROWS; row++) {
                let floorTile = tiles.getTileLocation(col, row)

                if (tiles.tileAtLocationIsWall(floorTile)) {
                    placeSpriteBottomAt(hero, floorTile.x, floorTile.top)
                    foundFloor = true
                    break
                }
            }
        }
    }

    hero.ay = GRAVITY

    if (!foundFloor) {
        let fallback = tiles.getTileLocation(startCol, startRow)
        hero.setPosition(fallback.x, fallback.y)
    }

    previousHeroBottom = hero.bottom
}

function placeHeroAtExactTile(col: number, row: number) {
    standingOnClimbable = false
    jumpingOffClimbable = false
    dropThroughPlatform = null
    hero.scale = 0.2
    hero.vx = 0
    hero.vy = 0
    hero.ay = GRAVITY
    hero.setFlag(SpriteFlag.GhostThroughWalls, false)
    climbing = false

    let spawn = tiles.getTileLocation(col, row)
    hero.setPosition(spawn.x, spawn.y)
    previousHeroBottom = hero.bottom
}

function addClimbableImage(asset: Image, location: tiles.Location) {
    let prop = trackStageSprite(
        sprites.create(asset, SpriteKind.Climbable)
    )

    prop.scale = 1.35
    placeSpriteBottomAt(prop, location.x, location.bottom)
    climbables.push(prop)
}

function spawnClimbablesFromMarkers() {
    let markers = markerLocations(MarkerType.Climbable)

    for (let marker of markers) {
        let choice = Math.randomRange(0, 5)

        if (choice == 0) {
            addClimbableImage(assets.image`forestLargeMushroom1`, marker)
            clearMarker(marker)
        } else if (choice == 1) {
            addClimbableImage(assets.image`forestLargeMushroom0`, marker)
            clearMarker(marker)
        } else if (choice == 2) {
            addClimbableImage(assets.image`forestMushroomPatch`, marker)
            clearMarker(marker)
        } else if (choice == 3) {
            addClimbableImage(assets.image`pedestal`, marker)
            clearMarker(marker)
        } else if (choice == 4) {
            addClimbableImage(assets.image`vine`, marker)
            clearMarker(marker)
        } else {
            tiles.setWallAt(marker, false)
            tiles.setTileAt(marker, assets.tile`stairLadder`)
        }
    }
}

function spawnEnemiesFromMarkers() {
    let markers = markerLocations(MarkerType.Enemy)

    for (let marker of markers) {
        if (Math.randomRange(0, 1) == 0) {
            addSkeletonAt(marker)
        } else {
            addBatAt(marker)
        }

        clearMarker(marker)
    }
}

function addCoinAt(location: tiles.Location) {
    let coin = trackStageSprite(
        sprites.create(assets.image`coin0`, SpriteKind.Coin)
    )
    coin.setPosition(location.x, location.y)
}

function addPotionAt(location: tiles.Location) {
    let potion = trackStageSprite(
        sprites.create(assets.image`potion10`, SpriteKind.Potion)
    )
    potion.setPosition(location.x, location.y)
}

function spawnItemsFromMarkers() {
    let markers = markerLocations(MarkerType.Item)

    for (let marker of markers) {
        if (Math.randomRange(0, 1) == 0) {
            addCoinAt(marker)
        } else {
            addPotionAt(marker)
        }

        clearMarker(marker)
    }
}

function createPrincess() {
    princess = trackStageSprite(
        sprites.create(img`
            . . . . . f f 4 4 f f . . . .
            . . . . f 5 4 5 5 4 5 f . . . .
            . . . f e 4 5 5 5 5 4 e f . .
            . . f b 3 e 4 4 4 4 e 3 b f .
            . . f 3 3 3 3 3 3 3 3 3 3 f .
            . f 3 3 e b 3 e e 3 b e 3 3 f .
            . f 3 3 f f e e e e f f 3 3 f .
            . f b b f b f e e f b f b b f .
            . f b b e 1 f 4 4 f 1 e b b f .
            f f b b f 4 4 4 4 4 4 f b b f f
            f b b f f f e e e e f f f b b f
            . f e e f b d d d d b f e e f .
            . . e 4 c d d d d d d c 4 e . .
            . . e f b d b d b d b b f e . .
            . . . f f 1 d 1 d 1 d f f . . .
            . . . . . f f b b f f . . . . .
        `, SpriteKind.Princess)
    )

    let col = LEVEL1_PRINCESS_COL
    let row = LEVEL1_PRINCESS_ROW

    if (levelNumber == 2) {
        col = LEVEL2_PRINCESS_COL
        row = LEVEL2_PRINCESS_ROW
    } else if (levelNumber == 3) {
        col = LEVEL3_PRINCESS_COL
        row = LEVEL3_PRINCESS_ROW
    }

    placeAtTileBottom(princess, col, row)
}

function showHeartAbovePrincess() {
    if (!princess) return

    let heart = trackStageSprite(
        sprites.create(image.create(16, 16), SpriteKind.Heart)
    )

    heart.setPosition(princess.x, princess.y - 20)
    animation.runImageAnimation(heart, assets.animation`heart`, 120, true)
}

function showLevelIntro() {
    if (introOverlayActive) destroyStageSprite(introOverlay)
    let card = image.create(128, 72)
    card.fill(1)
    card.drawRect(0, 0, 128, 72, 15)
    if (levelNumber == 1) {
        card.print("TWISTED TOWER", 32, 5, 15)
        card.print("Climb to rescue", 27, 18, 15)
        card.print("the princess; beat", 18, 29, 15)
        card.print("skellies and bats.", 18, 40, 15)
        card.print("A: attack  B: jump", 18, 56, 15)
    } else if (levelNumber == 2) {
        card.print("LEVEL 2", 48, 8, 15)
        card.print("Use the platforms", 24, 27, 15)
        card.print("to make your way up.", 14, 42, 15)
    } else {
        card.print("LEVEL 3", 48, 12, 15)
        card.print("Watch your step!", 28, 34, 15)
    }
    introOverlay = trackStageSprite(sprites.create(card, SpriteKind.IntroOverlay))
    introOverlay.setPosition(scene.cameraProperty(CameraProperty.X), scene.cameraProperty(CameraProperty.Y))
    introOverlay.z = 10000
    introOverlayActive = true
    introUntil = game.runtime() + 3500
    mode = GameMode.Intro
    hero.vx = 0
    hero.vy = 0
    hero.ay = 0
    for (let enemy of enemies) {
        if (!enemy) continue
        enemy.vx = 0
        enemy.vy = 0
        enemy.ay = 0
    }
}
function finishLevelIntro() {
    if (introOverlayActive) destroyStageSprite(introOverlay)
    introOverlayActive = false
    mode = GameMode.Playing
    hero.ay = GRAVITY
    for (let enemy of enemies) {
        if (!enemy) continue
        if (enemy.kind() == SpriteKind.Skeleton) enemy.ay = GRAVITY
    }
}

function showChestPrompt(location: tiles.Location) {
    if (mode != GameMode.Playing || !hero) return
    if (promptedChestCol == location.column && promptedChestRow == location.row && game.runtime() < chestPromptUntil) return
    promptedChestCol = location.column
    promptedChestRow = location.row
    chestPromptUntil = game.runtime() + 1800
    hero.sayText("Press A to open the chest", 1800)
}

function tryOpenNearbyChest(): boolean {
    if (!hero || mode != GameMode.Playing) return false
    let center = hero.tilemapLocation()
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            let col = center.column + dx
            let row = center.row + dy
            if (col < 0 || col >= MAP_COLUMNS || row < 0 || row >= MAP_ROWS) continue
            let location = tiles.getTileLocation(col, row)
            if (tiles.tileAtLocationEquals(location, sprites.dungeon.chestClosed)) {
                tiles.setTileAt(location, assets.tile`OPEN CHEST`)
                info.changeScoreBy(25)
                promptedChestCol = -1
                return true
            }
            if (tiles.tileAtLocationEquals(location, assets.tile`SWORDCHEST`)) {
                if (!hasSword) {
                    hasSword = true
                    info.changeScoreBy(25)
                    hero.sayText("Sword acquired!", 1200)
                }
                tiles.setTileAt(location, assets.tile`OPEN CHEST`)
                promptedChestCol = -1
                return true
            }
        }
    }
    return false
}
function beginPrincessEnding() {
    if (mode != GameMode.Playing) return

    showHeartAbovePrincess()

    if (levelNumber == 1) {
        mode = GameMode.WaitingForLevel2
        hero.vx = 0
        hero.vy = 0
        hero.ay = 0
        hero.sayText("Press A for Level 2", 3000)
    } else if (levelNumber == 2) {
        mode = GameMode.WaitingForLevel3
        hero.vx = 0
        hero.vy = 0
        hero.ay = 0
        hero.sayText("Press A for Level 3", 3000)
    } else {
        mode = GameMode.Ending
        hero.vx = 0
        hero.vy = 0
        hero.ay = 0
        hero.sayText("You found the princess!", 1200)

        control.runInParallel(function () {
            pause(1500)

            let elapsedSeconds = Math.floor((game.runtime() - startTime) / 1000)
            let timeBonus = Math.max(0, 3000 - elapsedSeconds * 8)

            info.changeScoreBy(timeBonus)
            info.changeScoreBy(-deathsThisRun * DEATH_SCORE_PENALTY)
            info.setScore(Math.max(0, info.score()))
            game.over(true, effects.confetti)
        })
    }
}

function touchingLadderTile(): boolean {
    if (!hero) return false

    let center = hero.tilemapLocation()

    for (let colOffset = -1; colOffset <= 1; colOffset++) {
        for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
            let col = clampNumber(center.column + colOffset, 0, MAP_COLUMNS - 1)
            let row = clampNumber(center.row + rowOffset, 0, MAP_ROWS - 1)
            let location = tiles.getTileLocation(col, row)

            if (
                tiles.tileAtLocationEquals(location, assets.tile`stairLadder`) ||
                tiles.tileAtLocationEquals(location, sprites.dungeon.stairNorth) ||
                tiles.tileAtLocationEquals(location, sprites.dungeon.stairLadder)
            ) {
                return true
            }
        }
    }

    return false
}

function touchingClimbableSprite(): boolean {
    if (!hero) return false

    for (let prop of climbables) {
        if (prop && prop.overlapsWith(hero)) {
            return true
        }
    }

    return false
}

function touchingClimbable(): boolean {
    return touchingLadderTile() || touchingClimbableSprite()
}

function beginDropThroughClimbable(): boolean {
    if (!hero || !standingOnClimbable) return false

    for (let prop of climbables) {
        if (!prop) continue

        let horizontalOverlap = hero.right > prop.left && hero.left < prop.right
        let onTop = hero.bottom >= prop.top - 4 && hero.bottom <= prop.top + 6

        if (horizontalOverlap && onTop) {
            dropThroughPlatform = prop
            standingOnClimbable = false
            climbing = false
            jumpingOffClimbable = false
            hero.setFlag(SpriteFlag.GhostThroughWalls, false)
            hero.ay = GRAVITY
            hero.vy = Math.max(40, hero.vy)
            hero.bottom = prop.top + 2
            previousHeroBottom = hero.bottom
            return true
        }
    }

    return false
}

function landOnClimbablePlatform(): boolean {
    if (dropThroughPlatform && hero.top > dropThroughPlatform.bottom) {
        dropThroughPlatform = null
    }

    if (!hero || climbing || hero.vy < 0) {
        standingOnClimbable = false
        return false
    }

    for (let prop of climbables) {
        if (!prop || prop == dropThroughPlatform) continue

        let horizontalOverlap = hero.right > prop.left && hero.left < prop.right
        let crossedTop = previousHeroBottom <= prop.top + 5 && hero.bottom >= prop.top - 2 && hero.bottom <= prop.top + 12

        if (horizontalOverlap && crossedTop) {
            hero.bottom = prop.top
            hero.vy = 0
            standingOnClimbable = true
            previousHeroBottom = hero.bottom
            return true
        }
    }

    standingOnClimbable = false
    return false
}

function damageEnemy(enemy: Sprite) {
    if (!enemy || sprites.readDataNumber(enemy, "hp") <= 0) return
    if (game.runtime() < sprites.readDataNumber(enemy, "hurtUntil")) return

    let hp = sprites.readDataNumber(enemy, "hp") - 1
    sprites.setDataNumber(enemy, "hp", hp)
    sprites.setDataNumber(enemy, "hurtUntil", game.runtime() + 300)

    let index = enemies.indexOf(enemy)
    if (index >= 0 && enemyHealthBars[index]) {
        enemyHealthBars[index].value = hp
    }

    if (hp <= 0) {
        enemiesDefeated += 1
        info.changeScoreBy(ENEMY_SCORE)

        if (index >= 0) {
            enemies[index] = null

            if (enemyHealthBars[index]) {
                enemyHealthBars[index].destroy()
                enemyHealthBars[index] = null
            }
        }

        destroyStageSprite(enemy)
    }
}

function performHeroAttack() {
    if (!hero || attacking || mode != GameMode.Playing) return

    attacking = true

    for (let enemy of enemies) {
        if (!enemy) continue

        let inFront = facingRight
            ? enemy.x >= hero.x - 4 && enemy.x <= hero.x + 32
            : enemy.x <= hero.x + 4 && enemy.x >= hero.x - 32

        if (inFront && Math.abs(enemy.y - hero.y) <= 26) {
            damageEnemy(enemy)
        }
    }

    control.runInParallel(function () {
        pause(250)
        attacking = false
    })
}

function respawnAtCurrentLevel() {
    if (!hero || !healthBar) return

    let respawnLevel = levelNumber
    deathsThisRun += 1
    if (enemiesDefeated > 0) info.changeScoreBy(-enemiesDefeated * ENEMY_SCORE)
    enemiesDefeated = 0
    hitCooldown = true
    healthBar.value = HERO_HEALTH
    loadLevel(respawnLevel)

    control.runInParallel(function () {
        pause(850)
        hitCooldown = false
    })
}

function damageHero(amount: number) {
    if (!hero || !healthBar || healthBar.value <= 0) return
    if (hitCooldown || mode != GameMode.Playing) return

    hitCooldown = true
    healthBar.value = Math.max(0, healthBar.value - amount)
    scene.cameraShake(3, 150)
    hero.vy = -55

    if (healthBar.value <= 0) {
        respawnAtCurrentLevel()
        return
    }

    control.runInParallel(function () {
        pause(850)
        hitCooldown = false
    })
}

function updateEnemies() {
    if (!hero) return

    let mapMinX = 8
    let mapMaxX = tiles.getTileLocation(MAP_COLUMNS - 1, 0).x
    let mapMinY = 8
    let mapMaxY = tiles.getTileLocation(0, MAP_ROWS - 1).y

    for (let enemy of enemies) {
        if (!enemy) continue

        let minX = sprites.readDataNumber(enemy, "minX")
        let maxX = sprites.readDataNumber(enemy, "maxX")
        let speed = sprites.readDataNumber(enemy, "speed")

        if (
            Math.abs(hero.x - enemy.x) < 96 &&
            Math.abs(hero.y - enemy.y) < 64 &&
            game.runtime() >= sprites.readDataNumber(enemy, "attackUntil")
        ) {
            sprites.setDataNumber(enemy, "attackUntil", game.runtime() + 650)
            sprites.setDataNumber(enemy, "attackingUntil", game.runtime() + 350)
        }

        let isAttacking =
            game.runtime() < sprites.readDataNumber(enemy, "attackingUntil")

        if (enemy.kind() == SpriteKind.Skeleton) {
            if (
                enemy.x <= minX ||
                enemy.isHittingTile(CollisionDirection.Left)
            ) {
                enemy.vx = speed
            } else if (
                enemy.x >= maxX ||
                enemy.isHittingTile(CollisionDirection.Right)
            ) {
                enemy.vx = -speed
            } else if (enemy.vx == 0) {
                enemy.vx = speed
            }

            if (isAttacking) {
                setEnemyAction(
                    enemy,
                    enemy.vx < 0 ? GameAction.AttackLeft : GameAction.AttackRight
                )
            } else {
                setEnemyAction(
                    enemy,
                    enemy.vx < 0 ? GameAction.WalkLeft : GameAction.WalkRight
                )
            }
        } else {
            let minY = sprites.readDataNumber(enemy, "minY")
            let maxY = sprites.readDataNumber(enemy, "maxY")

            if (enemy.x <= mapMinX) enemy.vx = speed
            if (enemy.x >= mapMaxX) enemy.vx = -speed
            if (enemy.y <= mapMinY) enemy.vy = speed
            if (enemy.y >= mapMaxY) enemy.vy = -speed

            if (Math.abs(hero.x - enemy.x) < 96 && Math.abs(hero.y - enemy.y) < 64) {
                enemy.vx = hero.x < enemy.x ? -speed : speed
                enemy.vy = hero.y < enemy.y ? -speed : speed
            }

            enemy.x = clampNumber(enemy.x, minX, maxX)
            enemy.y = clampNumber(enemy.y, minY, maxY)

            if (isAttacking) {
                setEnemyAction(
                    enemy,
                    enemy.vx < 0 ? GameAction.AttackLeft : GameAction.AttackRight
                )
            } else {
                setEnemyAction(
                    enemy,
                    enemy.vx < 0 ? GameAction.WalkLeft : GameAction.WalkRight
                )
            }
        }
    }
}

function makeWarningImage(width: number, height: number): Image {
    let warningImage = image.create(width, height)

    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            if ((Math.idiv(x, 6) + Math.idiv(y, 6)) % 2 == 0) {
                warningImage.setPixel(x, y, 5)
            } else if ((x + y) % 3 == 0) {
                warningImage.setPixel(x, y, 9)
            }
        }
    }

    warningImage.drawRect(0, 0, width, height, 1)
    return warningImage
}

function spawnBombHazard(generation: number) {
    let maxX = tiles.getTileLocation(MAP_COLUMNS - 1, 0).right - 24
    let maxY = tiles.getTileLocation(0, MAP_ROWS - 1).bottom - 24
    let targetX = Math.randomRange(24, maxX)
    let targetY = Math.randomRange(24, maxY)

    if (Math.randomRange(0, 4) < 3 && hero) {
        targetX = clampNumber(hero.x + Math.randomRange(-48, 48), 24, maxX)
        targetY = clampNumber(hero.y + Math.randomRange(-32, 32), 24, maxY)
    }

    let warning = trackStageSprite(
        sprites.create(makeWarningImage(48, 48), SpriteKind.Warning)
    )
    warning.setPosition(targetX, targetY)
    warning.z = 5

    control.runInParallel(function () {
        pause(650)
        if (generation != stageGeneration || levelNumber != 3) return
        destroyStageSprite(warning)

        let bomb = trackStageSprite(
            sprites.create(assets.animation`drop`[0], SpriteKind.Warning)
        )
        bomb.scale = 1.5
        bomb.setPosition(targetX, targetY - 72)
        bomb.setFlag(SpriteFlag.GhostThroughWalls, true)
        bomb.ay = 0
        bomb.vy = 170
        animation.runImageAnimation(bomb, assets.animation`drop`, 75, false)

        pause(430)
        if (generation != stageGeneration || levelNumber != 3) return
        destroyStageSprite(bomb)

        let blast = trackStageSprite(
            sprites.create(assets.animation`explosion`[0], SpriteKind.Hazard)
        )
        blast.scale = 1.8
        blast.setPosition(targetX, targetY)
        blast.setFlag(SpriteFlag.GhostThroughWalls, true)
        animation.runImageAnimation(blast, assets.animation`explosion`, 70, false)

        pause(550)
        if (generation != stageGeneration || levelNumber != 3) return
        destroyStageSprite(blast)
        hazardActive = false
    })
}

function spawnLaserHazard(generation: number) {
    let maxX = tiles.getTileLocation(MAP_COLUMNS - 1, 0).right - 24
    let maxY = tiles.getTileLocation(0, MAP_ROWS - 1).bottom - 24
    let targetX = Math.randomRange(24, maxX)
    let targetY = Math.randomRange(24, maxY)

    if (Math.randomRange(0, 4) < 3 && hero) {
        targetX = clampNumber(hero.x + Math.randomRange(-24, 24), 24, maxX)
        targetY = clampNumber(hero.y + Math.randomRange(-28, 28), 24, maxY)
    }

    let beamStartX = clampNumber(targetX - 80, 8, maxX - 120)
    let warning = trackStageSprite(
        sprites.create(makeWarningImage(160, 24), SpriteKind.Warning)
    )
    warning.setPosition(beamStartX + 80, targetY)
    warning.z = 5

    control.runInParallel(function () {
        pause(650)
        if (generation != stageGeneration || levelNumber != 3) return
        destroyStageSprite(warning)

        let beam = trackStageSprite(
            sprites.create(assets.animation`laser`[0], SpriteKind.Hazard)
        )
        beam.scale = 1.5
        beam.setFlag(SpriteFlag.GhostThroughWalls, true)
        beam.setPosition(beamStartX, targetY)
        beam.vx = 200
        animation.runImageAnimation(beam, assets.animation`laser`, 75, true)

        pause(1000)
        if (generation != stageGeneration || levelNumber != 3) return
        destroyStageSprite(beam)
        hazardActive = false
    })
}

function spawnRandomLevel3Hazard() {
    if (
        !gameStarted ||
        mode != GameMode.Playing ||
        levelNumber != 3 ||
        hazardActive
    ) {
        return
    }

    hazardActive = true
    let generation = stageGeneration
    if (Math.randomRange(0, 1) == 0) {
        spawnBombHazard(generation)
    } else {
        spawnLaserHazard(generation)
    }
}
function placeHeroAtLevelStart() {
    if (!hero) return

    if (levelNumber == 1) {
        placeHeroAt(LEVEL1_START_COL, LEVEL1_START_ROW)
    } else if (levelNumber == 2) {
        placeHeroAtExactTile(LEVEL2_START_COL, LEVEL2_START_ROW)
    } else {
        placeHeroAtExactTile(LEVEL3_START_COL, LEVEL3_START_ROW)
    }
}

function loadLevel(nextLevel: number) {
    if (!hero || nextLevel < 1 || nextLevel > 3) return

    stageGeneration += 1
    hazardActive = false
    clearStageSprites()

    levelNumber = nextLevel
    mode = GameMode.Playing
    climbing = false
    attacking = false

    hero.vx = 0
    hero.vy = 0
    hero.ay = GRAVITY
    hero.setFlag(SpriteFlag.GhostThroughWalls, false)

    if (nextLevel == 1) {
        tiles.setCurrentTilemap(tilemap`level1`)
    } else if (nextLevel == 2) {
        tiles.setCurrentTilemap(tilemap`level-2`)
    } else {
        tiles.setCurrentTilemap(tilemap`level-3`)
    }

    clearLadderWalls()
    scene.setBackgroundColor(11)
    placeHeroAtLevelStart()
    spawnClimbablesFromMarkers()
    spawnItemsFromMarkers()
    spawnEnemiesFromMarkers()
    createPrincess()
    promptedChestCol = -1
    promptedChestRow = -1
    showLevelIntro()
    scene.cameraFollowSprite(hero)
}
function handleEnemyOverlap(player: Sprite, enemy: Sprite) {
    if (attacking) {
        damageEnemy(enemy)
    } else {
        damageHero(1)
    }

    previousHeroBottom = hero.bottom
}

function startGame() {
    tiles.setCurrentTilemap(tilemap`level1`)
    clearLadderWalls()
    scene.setBackgroundColor(11)

    hero = sprites.create(assets.image`KNIGHTSPRITE`, SpriteKind.Player)
    hero.scale = 0.2
    controller.moveSprite(hero, HERO_SPEED, 0)
    hero.ay = GRAVITY

    healthBar = statusbars.create(28, 4, StatusBarKind.Health)
    healthBar.attachToSprite(hero, 2, 0)
    healthBar.max = HERO_HEALTH
    healthBar.value = HERO_HEALTH

    info.setScore(0)
    deathsThisRun = 0
    enemiesDefeated = 0
    coinsCollected = 0
    startTime = game.runtime()
    gameStarted = true


    loadLevel(1)
}
controller.A.onEvent(ControllerButtonEvent.Pressed, function () {
    if (!gameStarted) return

    if (
        levelNumber == 1 &&
        (mode == GameMode.WaitingForLevel2 || (princess && hero.overlapsWith(princess)))
    ) {
        loadLevel(2)
        return
    }

    if (
        levelNumber == 2 &&
        (mode == GameMode.WaitingForLevel3 || (princess && hero.overlapsWith(princess)))
    ) {
        loadLevel(3)
        return
    }

    if (mode == GameMode.Playing) {
        if (tryOpenNearbyChest()) return
        performHeroAttack()
    }
})
controller.B.onEvent(ControllerButtonEvent.Pressed, function () {
    if (!gameStarted || mode != GameMode.Playing) return

    if (
        climbing ||
        standingOnClimbable ||
        touchingClimbable() ||
        hero.isHittingTile(CollisionDirection.Bottom)
    ) {
        let wasOnClimbable = climbing || standingOnClimbable || touchingClimbable()
        climbing = false
        standingOnClimbable = false
        jumpingOffClimbable = wasOnClimbable
        hero.setFlag(SpriteFlag.GhostThroughWalls, false)
        hero.ay = GRAVITY
        hero.vy = JUMP_SPEED
        previousHeroBottom = hero.bottom

        if (controller.dx() != 0) {
            hero.vx = controller.dx() * HERO_SPEED
        }
    }
})

game.onUpdate(function () {
    if (!gameStarted) return
    if (mode == GameMode.Intro) {
        hero.vx = 0
        hero.vy = 0
        hero.ay = 0
        if (introOverlayActive) introOverlay.setPosition(scene.cameraProperty(CameraProperty.X), scene.cameraProperty(CameraProperty.Y))
        if (game.runtime() >= introUntil) finishLevelIntro()
        return
    }
    if (mode != GameMode.Playing) return

    let downPressed = controller.down.isPressed()
    if (downPressed && standingOnClimbable) beginDropThroughClimbable()
    if (dropThroughPlatform && hero.top > dropThroughPlatform.bottom) dropThroughPlatform = null
    let onClimbable = touchingClimbable()
    if (jumpingOffClimbable && !onClimbable) jumpingOffClimbable = false
    let upPressed = controller.up.isPressed()

    if (onClimbable && !jumpingOffClimbable && !dropThroughPlatform && (upPressed || downPressed)) {
        climbing = true
        hero.setFlag(SpriteFlag.GhostThroughWalls, true)
        hero.ay = 0
        hero.vy = downPressed ? CLIMB_SPEED : -CLIMB_SPEED
        hero.vx = controller.dx() * HERO_SPEED
    } else if (climbing && onClimbable) {
        hero.setFlag(SpriteFlag.GhostThroughWalls, true)
        hero.ay = 0
        hero.vy = 0
    } else if (climbing) {
        climbing = false
        hero.setFlag(SpriteFlag.GhostThroughWalls, false)
        hero.ay = GRAVITY
    }

    landOnClimbablePlatform()

    if (hero.vx < -1) {
        facingRight = false
    } else if (hero.vx > 1) {
        facingRight = true
    }

    if (hero.y > tileBottomY(MAP_ROWS - 1) + 32) {
        placeHeroAtLevelStart()
        damageHero(1)
    }

    previousHeroBottom = hero.bottom
})

game.onUpdateInterval(100, function () {
    if (gameStarted && mode == GameMode.Playing) {
        updateEnemies()
    }
})

game.onUpdateInterval(1700, function () {
    spawnRandomLevel3Hazard()
})

scene.onOverlapTile(SpriteKind.Player, assets.tile`TILEDOWN`, function (sprite, location) {
    tiles.setWallAt(location, false)

    if (controller.down.isPressed()) {
        climbing = true
        hero.setFlag(SpriteFlag.GhostThroughWalls, true)
        hero.ay = 0
        hero.vy = CLIMB_SPEED
    }
})

scene.onOverlapTile(SpriteKind.Player, sprites.dungeon.stairNorth, function (sprite, location) {
    tiles.setWallAt(location, false)

    if (controller.up.isPressed() || controller.down.isPressed()) {
        climbing = true
        hero.setFlag(SpriteFlag.GhostThroughWalls, true)
        hero.ay = 0
        hero.vy = controller.down.isPressed() ? CLIMB_SPEED : -CLIMB_SPEED
    }
})

scene.onOverlapTile(SpriteKind.Player, sprites.dungeon.stairLadder, function (sprite, location) {
    tiles.setWallAt(location, false)

    if (controller.up.isPressed() || controller.down.isPressed()) {
        climbing = true
        hero.setFlag(SpriteFlag.GhostThroughWalls, true)
        hero.ay = 0
        hero.vy = controller.down.isPressed() ? CLIMB_SPEED : -CLIMB_SPEED
    }
})

scene.onOverlapTile(SpriteKind.Player, assets.tile`stairLadder`, function (sprite, location) {
    tiles.setWallAt(location, false)

    if (controller.up.isPressed() || controller.down.isPressed()) {
        climbing = true
        hero.setFlag(SpriteFlag.GhostThroughWalls, true)
        hero.ay = 0
        hero.vy = controller.down.isPressed() ? CLIMB_SPEED : -CLIMB_SPEED
    }
})

scene.onOverlapTile(SpriteKind.Player, sprites.dungeon.chestClosed, function (sprite, location) {
    showChestPrompt(location)
})

scene.onOverlapTile(SpriteKind.Player, assets.tile`SWORDCHEST`, function (sprite, location) {
    showChestPrompt(location)
})

sprites.onOverlap(SpriteKind.Player, SpriteKind.Skeleton, handleEnemyOverlap)
sprites.onOverlap(SpriteKind.Player, SpriteKind.Bat, handleEnemyOverlap)

scene.onOverlapTile(SpriteKind.Player, assets.tile`hazardLava1`, function (player, location) {
    if (!hitCooldown) {
        respawnAtCurrentLevel()
    }
})

sprites.onOverlap(SpriteKind.Player, SpriteKind.Hazard, function (player, hazard) {
    destroyStageSprite(hazard)
    damageHero(2)
})

sprites.onOverlap(SpriteKind.Player, SpriteKind.Coin, function (player, coin) {
    destroyStageSprite(coin)
    coinsCollected += 1
    info.changeScoreBy(50)
})

sprites.onOverlap(SpriteKind.Player, SpriteKind.Potion, function (player, potion) {
    destroyStageSprite(potion)
    healthBar.value = Math.min(healthBar.max, healthBar.value + Math.ceil(healthBar.max / 2))
})

sprites.onOverlap(SpriteKind.Player, SpriteKind.Princess, function (player, target) {
    beginPrincessEnding()
})

startGame()