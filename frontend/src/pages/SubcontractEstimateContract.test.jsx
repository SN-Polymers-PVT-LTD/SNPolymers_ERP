import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import SubcontractEstimateForm from './SubcontractEstimateForm';
import SubcontractEstimateView from './SubcontractEstimateView';
import {
  renderPage,
  describePageContract,
  mockApiScenario
} from '../test';
import authApi from '../api/authApi';

vi.mock('../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { response: { use: vi.fn() } }
  }
}));

// Baseline Page Contracts for SubcontractEstimateForm and SubcontractEstimateView
describePageContract(SubcontractEstimateForm, {
  name: 'SubcontractEstimateForm',
  route: '/subcontract-estimates/new',
  allowedRoles: ['je', 'admin'],
  unauthorizedRole: 'zo',
  headingMatch: /New Subcontract Estimate/i
});

describePageContract(SubcontractEstimateView, {
  name: 'SubcontractEstimateView',
  route: '/subcontract-estimates/1',
  routePath: '/subcontract-estimates/:id',
  allowedRoles: ['je', 'zo', 'ho', 'admin'],
  unauthorizedRole: 'accounts',
  headingMatch: /Subcontract Estimate/i,
  initialScenario: {
    '/subcontract-estimates/1': {
      success: true,
      estimate: {
        id: 1,
        estimate_no: 'SCE-101',
        work_order_no: 'WO-101',
        status: 'Final Approved',
        lines: [],
        workflow_history: []
      }
    }
  }
});
