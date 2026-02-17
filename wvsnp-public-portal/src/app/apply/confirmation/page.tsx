'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/forms/button';

// Mock data - in real implementation, this would come from the submission response
const mockSubmissionData = {
  referenceCode: 'WVSNP-A7K2-M9X4',
  submittedAt: new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }),
  estimatedReviewTime: '2-4 weeks'
};

export default function ConfirmationPage() {
  const [copiedCode, setCopiedCode] = useState(false);

  const copyReferenceCode = async () => {
    try {
      await navigator.clipboard.writeText(mockSubmissionData.referenceCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (error) {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = mockSubmissionData.referenceCode;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-center py-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900">
                West Virginia Spay/Neuter Voucher Program
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Application Submitted Successfully
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          {/* Success Icon */}
          <div className="flex justify-center mb-6">
            <div className="bg-green-100 rounded-full p-4">
              <svg className="h-16 w-16 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>

          {/* Success Message */}
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Your Application Has Been Submitted!
          </h1>

          <p className="text-lg text-gray-600 mb-8">
            Thank you for applying to the West Virginia Spay/Neuter Voucher Program.
            Your application is now being processed.
          </p>

          {/* Reference Code - Prominent Display */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-6 mb-8">
            <h2 className="text-xl font-semibold text-blue-900 mb-4">
              Your Reference Code
            </h2>

            <div className="bg-white border-2 border-dashed border-blue-300 rounded-lg p-6 mb-4">
              <div className="text-4xl font-mono font-bold text-blue-600 tracking-wider mb-2">
                {mockSubmissionData.referenceCode}
              </div>

              <button
                onClick={copyReferenceCode}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                {copiedCode ? (
                  <>
                    <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Code
                  </>
                )}
              </button>
            </div>

            <p className="text-blue-800 font-medium">
              Save this code in case you need to look up your application later.
              We'll send updates by email (and text if you provided a phone number).
            </p>
          </div>

          {/* Submission Details */}
          <div className="bg-gray-50 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Submission Details
            </h3>

            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm font-medium text-gray-500">Submitted On:</dt>
                <dd className="text-sm text-gray-900">{mockSubmissionData.submittedAt}</dd>
              </div>

              <div className="flex justify-between">
                <dt className="text-sm font-medium text-gray-500">Estimated Review Time:</dt>
                <dd className="text-sm text-gray-900">{mockSubmissionData.estimatedReviewTime}</dd>
              </div>

              <div className="flex justify-between">
                <dt className="text-sm font-medium text-gray-500">Current Status:</dt>
                <dd className="text-sm text-green-600 font-medium">Application Received</dd>
              </div>
            </dl>
          </div>

          {/* Next Steps */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-8">
            <h3 className="text-lg font-semibold text-yellow-800 mb-4">
              What Happens Next?
            </h3>

            <div className="text-left space-y-3">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 bg-yellow-200 rounded-full flex items-center justify-center">
                    <span className="text-xs font-medium text-yellow-800">1</span>
                  </div>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-800">
                    <strong>Application Review:</strong> WVDA staff will review your application for completeness and eligibility.
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 bg-yellow-200 rounded-full flex items-center justify-center">
                    <span className="text-xs font-medium text-yellow-800">2</span>
                  </div>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-800">
                    <strong>Voucher Issuance:</strong> If approved, you'll receive an email with your voucher details and instructions.
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="w-6 h-6 bg-yellow-200 rounded-full flex items-center justify-center">
                    <span className="text-xs font-medium text-yellow-800">3</span>
                  </div>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-800">
                    <strong>Schedule Service:</strong> Contact your selected veterinarian to schedule the spay/neuter procedure.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-4">
            <Link href={`/status?code=${mockSubmissionData.referenceCode}`}>
              <Button className="w-full">
                Check Application Status (Optional)
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Button>
            </Link>

            <div className="text-center">
              <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                Return to Home
              </Link>
            </div>
          </div>

          {/* Contact Information */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="text-center text-sm text-gray-600">
              <p className="mb-2">
                Questions about your application?
              </p>
              <p>
                Call WVDA Helpline: <span className="font-medium">(304) 123-4567</span>
              </p>
              <p>
                Email: <span className="font-medium">spayneuter@wvsnp.org</span>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
