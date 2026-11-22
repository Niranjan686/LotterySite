const express = require('express');
const { param } = require('express-validator');
const winnerController = require('../controllers/winnerController');
const { handleValidationErrors } = require('../middleware/validateMiddleware');

const router = express.Router();

// Open direct routes — No login or authentication required
router.get('/', winnerController.listWinners);
router.get('/export', winnerController.exportWinners);
router.delete('/reset', winnerController.resetWinnerHistory);

router.get(
  '/:id',
  [param('id').isInt({ min: 1 }).withMessage('Valid Winner ID is required.')],
  handleValidationErrors,
  winnerController.getWinnerById
);

module.exports = router;
