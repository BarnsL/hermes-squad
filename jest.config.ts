/**
 * =============================================================================
 * Hermes Squad — Jest Configuration
 * =============================================================================
 * TypeScript-aware test configuration with support for:
 * - Unit tests (fast, isolated, no I/O)
 * - Integration tests (may spawn processes, use filesystem)
 * - E2E tests (full Electron app lifecycle)
 *
 * Uses ts-jest for TypeScript compilation and path alias resolution.
 * =============================================================================
 */

import type { Config } from 'jest';

const config: Config = {
  // ===========================================================================
  // Core Configuration
  // ===========================================================================

  // Display name shown in test output
  displayName: 'hermes-squad',

  // Use ts-jest preset for TypeScript support without pre-compilation
  preset: 'ts-jest',

  // Test environment — Node.js for main process / server code
  testEnvironment: 'node',

  // Root directory for finding tests and source files
  rootDir: '.',

  // Directories to search for test files
  roots: ['<rootDir>/tests', '<rootDir>/src'],

  // ===========================================================================
  // Test File Patterns
  // ===========================================================================

  // Pattern for test files — supports both .test.ts and .spec.ts conventions
  testMatch: [
    '<rootDir>/tests/**/*.test.ts',
    '<rootDir>/tests/**/*.spec.ts',
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/src/**/*.spec.ts',
  ],

  // Files to ignore when searching for tests
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/build/',
    // E2E tests are run separately with a different config
    '/tests/e2e/',
  ],

  // ===========================================================================
  // TypeScript Transformation
  // ===========================================================================

  transform: {
    // Use ts-jest for all TypeScript files
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        // Use the test-specific tsconfig
        tsconfig: 'tsconfig.test.json',
        // Enable ESM interop for packages that use default exports
        useESM: false,
        // Diagnostic settings — show type errors in tests
        diagnostics: {
          // Don't fail on type errors in test files (for mock flexibility)
          ignoreDiagnostics: [
            // Allow implicit any in tests
            7006,
            // Allow unused locals in tests
            6133,
          ],
        },
      },
    ],
  },

  // File extensions to consider when resolving imports
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // ===========================================================================
  // Module Resolution (Path Aliases)
  // ===========================================================================

  // Map TypeScript path aliases to Jest module paths
  moduleNameMapper: {
    // Source path aliases (must match tsconfig.json paths)
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@acp/(.*)$': '<rootDir>/src/acp/$1',
    '^@mcp/(.*)$': '<rootDir>/src/mcp/$1',
    '^@skills/(.*)$': '<rootDir>/src/skills/$1',
    '^@electron/(.*)$': '<rootDir>/src/electron/$1',
    '^@tui/(.*)$': '<rootDir>/src/tui/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@config/(.*)$': '<rootDir>/config/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',

    // Mock native modules that don't work in test environment
    '^node-pty$': '<rootDir>/tests/__mocks__/node-pty.ts',
    '^electron$': '<rootDir>/tests/__mocks__/electron.ts',
    '^keytar$': '<rootDir>/tests/__mocks__/keytar.ts',
  },

  // ===========================================================================
  // Coverage Configuration
  // ===========================================================================

  // Collect coverage from these source files
  collectCoverageFrom: [
    'src/**/*.ts',
    // Exclude type definitions
    '!src/**/*.d.ts',
    // Exclude barrel exports (index.ts re-exports)
    '!src/**/index.ts',
    // Exclude Electron main process entry (hard to unit test)
    '!src/electron/main.ts',
    // Exclude generated code
    '!src/**/*.generated.ts',
  ],

  // Coverage output directory
  coverageDirectory: 'coverage',

  // Coverage reporters — lcov for CI, text for terminal
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],

  // Coverage thresholds — fail if coverage drops below these values
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
    // Stricter thresholds for critical modules
    './src/core/': {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    './src/acp/': {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },

  // ===========================================================================
  // Setup & Teardown
  // ===========================================================================

  // Global setup — runs once before all test suites
  globalSetup: '<rootDir>/tests/setup/global-setup.ts',

  // Global teardown — runs once after all test suites
  globalTeardown: '<rootDir>/tests/setup/global-teardown.ts',

  // Setup files — run before each test suite (after test framework is installed)
  setupFilesAfterFramework: [],

  // Setup files — run before each test file
  setupFiles: ['<rootDir>/tests/setup/env-setup.ts'],

  // Setup after env — extend Jest matchers, configure mocks
  setupFilesAfterFramework: undefined,

  // ===========================================================================
  // Performance & Execution
  // ===========================================================================

  // Run tests in parallel (one worker per CPU core)
  maxWorkers: '50%',

  // Timeout for individual tests (10 seconds — generous for spawn-based tests)
  testTimeout: 10_000,

  // Clear mock calls, instances, contexts and results between every test
  clearMocks: true,

  // Restore mock implementations between tests
  restoreMocks: true,

  // Reset modules between tests for isolation
  resetModules: false,

  // Automatically mock all imported modules (opt-in style is better)
  automock: false,

  // ===========================================================================
  // Reporting
  // ===========================================================================

  // Use verbose output for CI, minimal for local dev
  verbose: process.env.CI === 'true',

  // Show notification on test completion (local dev only)
  notify: process.env.CI !== 'true',

  // Custom reporters
  reporters: [
    'default',
    // JUnit XML output for CI systems
    ...(process.env.CI === 'true'
      ? [
          [
            'jest-junit',
            {
              outputDirectory: 'reports',
              outputName: 'junit.xml',
              classNameTemplate: '{classname}',
              titleTemplate: '{title}',
            },
          ],
        ]
      : []),
  ],

  // ===========================================================================
  // Projects (Multi-Config)
  // ===========================================================================
  // Uncomment to run different test types with different configs:
  //
  // projects: [
  //   {
  //     displayName: 'unit',
  //     testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  //     testEnvironment: 'node',
  //   },
  //   {
  //     displayName: 'integration',
  //     testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  //     testEnvironment: 'node',
  //     testTimeout: 30000,
  //   },
  // ],
};

export default config;
