/* =========================================================================
   SOCIETY PLAY & WIN - COMPLETE MICROSOFT SQL SERVER DATABASE SCRIPT
   Entertainment Lucky Draw System for Residential Societies (No Login / Auth)
   Compatible with: SQL Server 2016 / 2019 / 2022 & SSMS
   ========================================================================= */

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- 1. CREATE DATABASE IF NOT EXISTS
IF DB_ID(N'SocietyPlayWin') IS NULL
BEGIN
    CREATE DATABASE [SocietyPlayWin];
    PRINT 'Database [SocietyPlayWin] created successfully.';
END
ELSE
BEGIN
    PRINT 'Database [SocietyPlayWin] already exists.';
END
GO

USE [SocietyPlayWin];
GO

-- Clean up any legacy authentication objects if upgrading from an older schema
IF OBJECT_ID(N'dbo.FK_GameSessions_Admins', N'F') IS NOT NULL
    ALTER TABLE dbo.GameSessions DROP CONSTRAINT FK_GameSessions_Admins;
GO

IF COL_LENGTH(N'dbo.GameSessions', N'AdminID') IS NOT NULL
    ALTER TABLE dbo.GameSessions DROP COLUMN AdminID;
GO

IF OBJECT_ID(N'dbo.Admins', N'U') IS NOT NULL
    DROP TABLE dbo.Admins;
GO

/* =========================================================================
   TABLE 1: Societies
   Stores society name, address, branding logo, hero building image, and capacity.
   ========================================================================= */
IF OBJECT_ID(N'dbo.Societies', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Societies (
        SocietyID       INT IDENTITY(1,1) NOT NULL,
        SocietyName     NVARCHAR(150)     NOT NULL,
        SocietyAddress  NVARCHAR(500)     NOT NULL CONSTRAINT DF_Societies_Address DEFAULT (N'Main Residential Avenue, India'),
        SocietyLogo     NVARCHAR(MAX)     NULL,
        SocietyImage    NVARCHAR(MAX)     NULL,
        TotalFlats      INT               NOT NULL CONSTRAINT DF_Societies_TotalFlats DEFAULT (500),
        CommitteeName   NVARCHAR(150)     NOT NULL CONSTRAINT DF_Societies_Committee DEFAULT (N'Society Cultural & Events Committee'),
        ContactPhone    NVARCHAR(30)      NULL,
        CreatedAt       DATETIME2(3)      NOT NULL CONSTRAINT DF_Societies_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt       DATETIME2(3)      NOT NULL CONSTRAINT DF_Societies_UpdatedAt DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_Societies PRIMARY KEY CLUSTERED (SocietyID),
        CONSTRAINT UQ_Societies_SocietyName UNIQUE (SocietyName),
        CONSTRAINT CK_Societies_TotalFlats CHECK (TotalFlats >= 1 AND TotalFlats <= 50000)
    );
    PRINT 'Table [dbo.Societies] created.';
END
ELSE
BEGIN
    IF COL_LENGTH(N'dbo.Societies', N'SocietyImage') IS NULL
        ALTER TABLE dbo.Societies ADD SocietyImage NVARCHAR(MAX) NULL;

    IF COL_LENGTH(N'dbo.Societies', N'CommitteeName') IS NULL
        ALTER TABLE dbo.Societies ADD CommitteeName NVARCHAR(150) NOT NULL CONSTRAINT DF_Societies_Committee_Upg DEFAULT (N'Society Cultural & Events Committee');

    IF COL_LENGTH(N'dbo.Societies', N'ContactPhone') IS NULL
        ALTER TABLE dbo.Societies ADD ContactPhone NVARCHAR(30) NULL;
END
GO

/* =========================================================================
   TABLE 2: Flats
   Stores society flats, owners, optional mobile numbers, and draw eligibility.
   ========================================================================= */
IF OBJECT_ID(N'dbo.Flats', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Flats (
        FlatID              INT IDENTITY(1,1) NOT NULL,
        SocietyID           INT               NOT NULL,
        SocietyName         NVARCHAR(150)     NOT NULL,
        FlatNumber          NVARCHAR(50)      NOT NULL,
        OwnerName           NVARCHAR(150)     NOT NULL,
        MobileNumber        NVARCHAR(25)      NULL,
        ParticipationStatus BIT               NOT NULL CONSTRAINT DF_Flats_Participation DEFAULT (1),
        CreatedAt           DATETIME2(3)      NOT NULL CONSTRAINT DF_Flats_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt           DATETIME2(3)      NOT NULL CONSTRAINT DF_Flats_UpdatedAt DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_Flats PRIMARY KEY CLUSTERED (FlatID),
        CONSTRAINT FK_Flats_Societies FOREIGN KEY (SocietyID)
            REFERENCES dbo.Societies (SocietyID) ON DELETE CASCADE,
        CONSTRAINT UQ_Flats_Society_FlatNumber UNIQUE (SocietyID, FlatNumber)
    );

    CREATE NONCLUSTERED INDEX IX_Flats_OwnerName
        ON dbo.Flats (OwnerName);

    CREATE NONCLUSTERED INDEX IX_Flats_FlatNumber
        ON dbo.Flats (FlatNumber);

    CREATE NONCLUSTERED INDEX IX_Flats_Eligibility
        ON dbo.Flats (SocietyID, ParticipationStatus)
        INCLUDE (FlatNumber, OwnerName, MobileNumber, SocietyName);

    PRINT 'Table [dbo.Flats] created.';
END
GO

/* =========================================================================
   TABLE 3: GameSessions
   Records every 3-reel slot machine spin session and match status.
   ========================================================================= */
IF OBJECT_ID(N'dbo.GameSessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.GameSessions (
        GameID          INT IDENTITY(1,1) NOT NULL,
        SessionCode     AS ('SPW-' + RIGHT('000000' + CAST(GameID AS VARCHAR(10)), 6)) PERSISTED,
        SocietyID       INT               NULL,
        Reel1Symbol     NVARCHAR(50)      NOT NULL,
        Reel2Symbol     NVARCHAR(50)      NOT NULL,
        Reel3Symbol     NVARCHAR(50)      NOT NULL,
        IsWinningMatch  BIT               NOT NULL CONSTRAINT DF_GameSessions_IsWin DEFAULT (0),
        PlayedAt        DATETIME2(3)      NOT NULL CONSTRAINT DF_GameSessions_PlayedAt DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_GameSessions PRIMARY KEY CLUSTERED (GameID),
        CONSTRAINT FK_GameSessions_Societies FOREIGN KEY (SocietyID)
            REFERENCES dbo.Societies (SocietyID) ON DELETE SET NULL
    );

    CREATE NONCLUSTERED INDEX IX_GameSessions_PlayedAt
        ON dbo.GameSessions (PlayedAt DESC)
        INCLUDE (IsWinningMatch, SocietyID);

    PRINT 'Table [dbo.GameSessions] created.';
END
GO

/* =========================================================================
   TABLE 4: Winners
   Stores official winners selected cryptographically on the Node.js backend.
   ========================================================================= */
IF OBJECT_ID(N'dbo.Winners', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Winners (
        WinnerID        INT IDENTITY(1,1) NOT NULL,
        CertificateNo   AS ('CERT-' + RIGHT('000000' + CAST(WinnerID AS VARCHAR(10)), 6)) PERSISTED,
        GameID          INT               NOT NULL,
        FlatID          INT               NULL,
        SocietyID       INT               NOT NULL,
        OwnerName       NVARCHAR(150)     NOT NULL,
        FlatNumber      NVARCHAR(50)      NOT NULL,
        SocietyName     NVARCHAR(150)     NOT NULL,
        MobileNumber    NVARCHAR(25)      NULL,
        MatchedSymbol   NVARCHAR(50)      NOT NULL,
        PrizeTitle      NVARCHAR(150)     NOT NULL CONSTRAINT DF_Winners_PrizeTitle DEFAULT (N'Official Society Play & Win Winner'),
        DrawDateTime    DATETIME2(3)      NOT NULL CONSTRAINT DF_Winners_DrawDateTime DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_Winners PRIMARY KEY CLUSTERED (WinnerID),
        CONSTRAINT UQ_Winners_GameID UNIQUE (GameID),
        CONSTRAINT FK_Winners_GameSessions FOREIGN KEY (GameID)
            REFERENCES dbo.GameSessions (GameID) ON DELETE CASCADE,
        CONSTRAINT FK_Winners_Flats FOREIGN KEY (FlatID)
            REFERENCES dbo.Flats (FlatID) ON DELETE NO ACTION,
        CONSTRAINT FK_Winners_Societies FOREIGN KEY (SocietyID)
            REFERENCES dbo.Societies (SocietyID) ON DELETE NO ACTION
    );

    CREATE NONCLUSTERED INDEX IX_Winners_FlatID
        ON dbo.Winners (FlatID);

    CREATE NONCLUSTERED INDEX IX_Winners_DrawDateTime
        ON dbo.Winners (DrawDateTime DESC)
        INCLUDE (OwnerName, FlatNumber, SocietyName, GameID, MatchedSymbol);

    CREATE NONCLUSTERED INDEX IX_Winners_Society_Search
        ON dbo.Winners (SocietyID, OwnerName, FlatNumber);

    PRINT 'Table [dbo.Winners] created.';
END
ELSE
BEGIN
    ALTER TABLE dbo.Winners ALTER COLUMN FlatID INT NULL;
END
GO

/* =========================================================================
   TABLE 5: GameSettings
   Stores configurable slot machine and draw rules (including NoRepeatWinner).
   ========================================================================= */
IF OBJECT_ID(N'dbo.GameSettings', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.GameSettings (
        SettingID               INT IDENTITY(1,1) NOT NULL,
        SocietyID               INT               NOT NULL,
        NoRepeatWinner          BIT               NOT NULL CONSTRAINT DF_GameSettings_NoRepeat DEFAULT (1),
        SoundEnabled            BIT               NOT NULL CONSTRAINT DF_GameSettings_Sound DEFAULT (1),
        ConfettiEnabled         BIT               NOT NULL CONSTRAINT DF_GameSettings_Confetti DEFAULT (1),
        SpinDurationMs          INT               NOT NULL CONSTRAINT DF_GameSettings_SpinDuration DEFAULT (3200),
        MatchRatePercent        INT               NOT NULL CONSTRAINT DF_GameSettings_MatchRate DEFAULT (35),
        EventTitle              NVARCHAR(150)     NOT NULL CONSTRAINT DF_GameSettings_EventTitle DEFAULT (N'Annual Society Family Festival & Lucky Draw'),
        PrizeTitle              NVARCHAR(150)     NOT NULL CONSTRAINT DF_GameSettings_PrizeTitle DEFAULT (N'Official Society Play & Win Winner'),
        UpdatedAt               DATETIME2(3)      NOT NULL CONSTRAINT DF_GameSettings_UpdatedAt DEFAULT (SYSDATETIME()),

        CONSTRAINT PK_GameSettings PRIMARY KEY CLUSTERED (SettingID),
        CONSTRAINT UQ_GameSettings_SocietyID UNIQUE (SocietyID),
        CONSTRAINT FK_GameSettings_Societies FOREIGN KEY (SocietyID)
            REFERENCES dbo.Societies (SocietyID) ON DELETE CASCADE,
        CONSTRAINT CK_GameSettings_SpinDuration CHECK (SpinDurationMs BETWEEN 1500 AND 10000),
        CONSTRAINT CK_GameSettings_MatchRate CHECK (MatchRatePercent BETWEEN 5 AND 100)
    );

    PRINT 'Table [dbo.GameSettings] created.';
END
GO

/* =========================================================================
   INITIAL TRANSACTIONAL CONFIGURATION SEED
   Creates default Society, GameSettings, and starter sample Flats if empty.
   Note: Winners and GameSessions start 100% empty (zero fake winners).
   ========================================================================= */
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @DefaultSocietyID INT;
    DECLARE @DefaultSocietyName NVARCHAR(150) = N'Royal Palms Co-operative Housing Society';

    IF NOT EXISTS (SELECT 1 FROM dbo.Societies)
    BEGIN
        INSERT INTO dbo.Societies (
            SocietyName,
            SocietyAddress,
            SocietyLogo,
            SocietyImage,
            TotalFlats,
            CommitteeName,
            ContactPhone
        )
        VALUES (
            @DefaultSocietyName,
            N'Plot 42, Palm Boulevard, Sector 18, Navi Mumbai - 400706',
            NULL,
            NULL,
            500,
            N'Society Cultural & Events Committee',
            N'+91 98200 12345'
        );

        SET @DefaultSocietyID = SCOPE_IDENTITY();
        PRINT 'Default Society profile initialized.';
    END
    ELSE
    BEGIN
        SELECT TOP 1
            @DefaultSocietyID = SocietyID,
            @DefaultSocietyName = SocietyName
        FROM dbo.Societies
        ORDER BY SocietyID ASC;
    END

    IF @DefaultSocietyID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.GameSettings WHERE SocietyID = @DefaultSocietyID)
    BEGIN
        INSERT INTO dbo.GameSettings (
            SocietyID,
            NoRepeatWinner,
            SoundEnabled,
            ConfettiEnabled,
            SpinDurationMs,
            MatchRatePercent,
            EventTitle,
            PrizeTitle
        )
        VALUES (
            @DefaultSocietyID,
            1,
            1,
            1,
            3200,
            35,
            N'Annual Society Family Festival & Lucky Draw',
            N'Official Society Play & Win Winner'
        );
        PRINT 'Default GameSettings initialized.';
    END

    -- Seed starter sample flats only when Flats table is empty so the game is ready to test
    IF @DefaultSocietyID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Flats)
    BEGIN
        INSERT INTO dbo.Flats (SocietyID, SocietyName, FlatNumber, OwnerName, MobileNumber, ParticipationStatus)
        VALUES
            (@DefaultSocietyID, @DefaultSocietyName, N'A-101', N'Aarav Sharma',      N'9820110101', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'A-102', N'Priya Patel',       N'9820110102', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'A-201', N'Vikram Deshmukh',   N'9820110201', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'A-202', N'Ananya Iyer',       N'9820110202', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'B-101', N'Rohan Kulkarni',    N'9820210101', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'B-102', N'Meera Nair',        N'9820210102', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'B-201', N'Rajesh Mehta',      N'9820210201', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'B-202', N'Kavita Verma',      N'9820210202', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'C-101', N'Siddharth Joshi',   N'9820310101', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'C-102', N'Neha Gupta',        N'9820310102', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'C-201', N'Arjun Reddy',       N'9820310201', 1),
            (@DefaultSocietyID, @DefaultSocietyName, N'C-202', N'Pooja Chatterjee',  N'9820310202', 1);

        PRINT '12 starter flats registered.';
    END

    COMMIT TRANSACTION;
    PRINT 'Database setup transaction committed successfully.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
    DECLARE @ErrSeverity INT = ERROR_SEVERITY();
    DECLARE @ErrState INT = ERROR_STATE();
    RAISERROR (@ErrMsg, @ErrSeverity, @ErrState);
END CATCH
GO
