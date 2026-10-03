import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessLocalCriteria,
  buildLocalCriterionQuestions,
  type LocalCriterionSetDefinition
} from '../src/index.ts';

const set: LocalCriterionSetDefinition = {
  id: 'set-1',
  version: 3,
  sourceHash: 'a'.repeat(64),
  minimumPoints: 5,
  maximumPoints: 8,
  criteria: [
    {
      code: 'QUALIFICATIONS',
      title: 'Kwalifikacje związane z działalnością',
      maxPoints: 3,
      failIfZero: true,
      scoringJson: {
        type: 'BOOLEAN',
        question: 'Czy posiadasz wymagane kwalifikacje?',
        truePoints: 3,
        falsePoints: 0
      }
    },
    {
      code: 'EXPERIENCE',
      title: 'Doświadczenie',
      maxPoints: 3,
      scoringJson: {
        type: 'NUMBER_BANDS',
        question: 'Ile pełnych lat doświadczenia posiadasz?',
        bands: [
          { max: 0, points: 0 },
          { min: 1, max: 2, points: 1 },
          { min: 3, max: 4, points: 2 },
          { min: 5, points: 3 }
        ]
      }
    },
    {
      code: 'SWOT',
      title: 'Ocena SWOT',
      maxPoints: 2,
      scoringJson: {
        type: 'MANUAL_REVIEW',
        question: 'Ocena jakości analizy SWOT'
      }
    }
  ]
};

test('questions are generated only from verified scoring definitions', () => {
  const questions = buildLocalCriterionQuestions(set.criteria);
  assert.equal(questions[0].inputType, 'BOOLEAN');
  assert.equal(questions[1].inputType, 'NUMBER');
  assert.equal(questions[2].inputType, 'EVIDENCE');
});

test('manual-review criterion keeps assessment unresolved', () => {
  const result = assessLocalCriteria(set, {
    QUALIFICATIONS: true,
    EXPERIENCE: 5,
    SWOT: 'Załączono analizę'
  });

  assert.equal(result.knownPoints, 6);
  assert.equal(result.possiblePoints, 8);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.deepEqual(result.unresolvedCriteria, ['SWOT']);
});

test('zero on verified blocking criterion blocks assessment', () => {
  const result = assessLocalCriteria(set, {
    QUALIFICATIONS: false,
    EXPERIENCE: 5
  });

  assert.equal(result.status, 'BLOCKING_CRITERION_FAILED');
  assert.deepEqual(result.blockingFailures, ['QUALIFICATIONS']);
});

test('automatic extraction metadata never awards points', () => {
  const result = assessLocalCriteria({
    ...set,
    minimumPoints: null,
    criteria: [{
      code: 'AUTO',
      title: 'Automatycznie wykryte kryterium',
      maxPoints: 4,
      scoringJson: {
        type: 'AUTO_EXTRACTED_MAX_POINTS',
        rawMatch: 'Maksymalnie 4 pkt'
      }
    }]
  }, {
    AUTO: 'dowolna odpowiedź'
  });

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.knownPoints, 0);
  assert.deepEqual(result.unresolvedCriteria, ['AUTO']);
});

test('threshold is marked met only when every scoring item is resolved', () => {
  const result = assessLocalCriteria({
    ...set,
    criteria: set.criteria.slice(0, 2),
    maximumPoints: 6,
    minimumPoints: 5
  }, {
    QUALIFICATIONS: true,
    EXPERIENCE: 5
  });

  assert.equal(result.status, 'LOCAL_THRESHOLD_MET');
  assert.equal(result.thresholdMet, true);
  assert.equal(result.knownPoints, 6);
});
