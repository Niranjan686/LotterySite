const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const gameController = require('../controllers/gameController');
const { handleValidationErrors } = require('../middleware/validateMiddleware');

const router = express.Router();

// Prevent automated rapid-fire spin API abuse
const spinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'SPIN_RATE_LIMIT',
    message: 'Too many rapid spins detected. Please wait a moment before spinning again.'
  }
});

// Open direct routes — No login or authentication required
router.get('/state', gameController.getGameState);

router.put(
  '/settings',
  [
    body('noRepeatWinner').isBoolean().withMessage('noRepeatWinner must be boolean.'),
    body('spinDurationMs')
      .optional()
      .isInt({ min: 1500, max: 10000 })
      .withMessage('Spin duration must be between 1500 and 10000 ms.'),
    body('matchRatePercent')
      .optional()
      .isInt({ min: 5, max: 100 })
      .withMessage('Match rate must be between 5% and 100%.')
  ],
  handleValidationErrors,
  gameController.updateGameSettings
);

router.post(
  '/spin',
  spinLimiter,
  [
    body('societyId')
      .optional({ values: 'falsy' })
      .isInt({ min: 1 })
      .withMessage('societyId must be a valid integer.')
  ],
  handleValidationErrors,
  gameController.spinSlotMachine
);

module.exports = router;
