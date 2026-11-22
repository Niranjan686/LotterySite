const express = require('express');
const { body } = require('express-validator');
const societyController = require('../controllers/societyController');
const { handleValidationErrors } = require('../middleware/validateMiddleware');

const router = express.Router();

// Open direct routes — No login or authentication required
router.get('/', societyController.getSocietyProfile);
router.get('/dashboard', societyController.getDashboardSummary);

router.post(
  '/',
  [
    body('societyName')
      .trim()
      .isLength({ min: 2, max: 150 })
      .withMessage('Society Name is required (2–150 characters).'),
    body('societyAddress')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 500 })
      .withMessage('Society Address cannot exceed 500 characters.'),
    body('totalFlats')
      .optional({ values: 'falsy' })
      .isInt({ min: 1, max: 50000 })
      .withMessage('Total Flats must be between 1 and 50,000.')
  ],
  handleValidationErrors,
  societyController.createSociety
);

router.put(
  '/',
  [
    body('societyName')
      .trim()
      .isLength({ min: 2, max: 150 })
      .withMessage('Society Name is required (2–150 characters).'),
    body('societyAddress')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ min: 2, max: 500 })
      .withMessage('Society Address must be between 2 and 500 characters.'),
    body('totalFlats')
      .optional({ values: 'falsy' })
      .isInt({ min: 1, max: 50000 })
      .withMessage('Total Flats must be between 1 and 50,000.'),
    body('committeeName')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 150 })
      .withMessage('Committee / Organizer Name cannot exceed 150 characters.'),
    body('contactPhone')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 30 })
      .withMessage('Contact Phone cannot exceed 30 characters.')
  ],
  handleValidationErrors,
  societyController.updateSocietyProfile
);

module.exports = router;
