'use client';

import React from 'react';

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  isCompleted: boolean;
  isCurrent: boolean;
}

interface WizardNavigationProps {
  steps: WizardStep[];
  onStepClick: (stepId: string) => void;
  canNavigateToStep: (stepId: string) => boolean;
}

export function WizardNavigation({ steps, onStepClick, canNavigateToStep }: WizardNavigationProps) {
  return (
    <nav className="w-full" aria-label="Application steps">
      <ol className="flex items-center justify-between w-full">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center w-full">
            <div className="flex flex-col items-center w-full">
              {/* Step Circle */}
              <button
                onClick={() => canNavigateToStep(step.id) && onStepClick(step.id)}
                disabled={!canNavigateToStep(step.id)}
                className={`
                  flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors
                  ${step.isCompleted
                    ? 'bg-green-600 border-green-600 text-white'
                    : step.isCurrent
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : canNavigateToStep(step.id)
                    ? 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
                    : 'bg-gray-100 border-gray-200 text-gray-300 cursor-not-allowed'
                  }
                `}
                aria-current={step.isCurrent ? 'step' : undefined}
                aria-label={`Step ${index + 1}: ${step.title}${step.isCompleted ? ' (completed)' : ''}`}
              >
                {step.isCompleted ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </button>

              {/* Step Title */}
              <div className="mt-2 text-center">
                <div className={`
                  text-sm font-medium
                  ${step.isCurrent ? 'text-blue-600' : step.isCompleted ? 'text-green-600' : 'text-gray-500'}
                `}>
                  {step.title}
                </div>
                <div className="text-xs text-gray-400 mt-1 max-w-24">
                  {step.description}
                </div>
              </div>
            </div>

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div className={`
                flex-auto h-px mx-4 transition-colors
                ${step.isCompleted ? 'bg-green-600' : 'bg-gray-200'}
              `} />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
