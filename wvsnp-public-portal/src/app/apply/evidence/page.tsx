'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FormField } from '@/components/forms/form-field';
import { Button } from '@/components/forms/button';
import { FileUpload } from '@/components/upload/file-upload';

interface EvidenceFile {
  file: File;
  hash: string;
  uploaded: boolean;
  uploadUrl?: string;
}

export default function EvidencePage() {
  const [incomeEvidence, setIncomeEvidence] = useState<EvidenceFile | null>(null);
  const [animalPhotos, setAnimalPhotos] = useState<EvidenceFile[]>([]);
  const [skipUploads, setSkipUploads] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleIncomeFileSelect = (file: File, hash: string) => {
    setIncomeEvidence({ file, hash, uploaded: false });
  };

  const handleIncomeUploadComplete = (file: File, hash: string, uploadUrl?: string) => {
    setIncomeEvidence({ file, hash, uploaded: true, uploadUrl });
  };

  const handleAnimalPhotoSelect = (file: File, hash: string) => {
    const newPhoto: EvidenceFile = { file, hash, uploaded: false };
    setAnimalPhotos(prev => [...prev, newPhoto]);
  };

  const handleAnimalPhotoUploadComplete = (index: number) => (file: File, hash: string, uploadUrl?: string) => {
    setAnimalPhotos(prev => prev.map((photo, i) =>
      i === index ? { ...photo, uploaded: true, uploadUrl } : photo
    ));
  };

  const removeAnimalPhoto = (index: number) => {
    setAnimalPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Check if required evidence is uploaded or user chose to skip
      const hasRequiredEvidence = incomeEvidence?.uploaded || skipUploads;

      if (!hasRequiredEvidence) {
        alert('Please upload proof of income qualification or select "I\'ll upload later"');
        setIsSubmitting(false);
        return;
      }

      // Save evidence data to API and offline store (Phase 2: API Integration)

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Navigate to next step
      window.location.href = '/apply/review';
    } catch (error) {
      console.error('Error saving evidence:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = () => {
    return (incomeEvidence?.uploaded || skipUploads);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <Link href="/apply/veterinarian" className="flex items-center">
                <svg className="h-8 w-8 text-blue-600 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="text-lg font-semibold text-gray-900">Back to Vet Selection</span>
              </Link>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Step 5 of 6:</span> Supporting Evidence
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Upload Supporting Documents
            </h1>
            <p className="text-lg text-gray-600">
              Please provide documentation to support your application. These documents help us verify your eligibility for the program.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Income Verification - Required */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-4">
                Proof of Income Qualification <span className="text-red-500">*</span>
              </h3>
              <p className="text-blue-800 mb-4">
                Please upload documentation that shows your household income meets the program requirements.
                This could include recent pay stubs, tax returns, social security statements, or other proof of income.
              </p>

              <FileUpload
                label="Upload income verification document"
                onFileSelect={handleIncomeFileSelect}
                onUploadComplete={handleIncomeUploadComplete}
                acceptedTypes=".jpg,.jpeg,.png,.pdf"
                maxSizeMB={10}
                required={!skipUploads}
                currentFile={incomeEvidence ? {
                  name: incomeEvidence.file.name,
                  hash: incomeEvidence.hash,
                  size: incomeEvidence.file.size
                } : undefined}
              />
            </div>

            {/* Animal Photos - Optional */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Animal Photos (Optional)
              </h3>
              <p className="text-gray-700 mb-4">
                Upload photos of your animal(s) to help us process your application. This is optional but recommended.
              </p>

              {/* Existing Photos */}
              {animalPhotos.length > 0 && (
                <div className="mb-4 space-y-2">
                  {animalPhotos.map((photo, index) => (
                    <div key={index} className="flex items-center justify-between bg-white p-3 rounded border">
                      <div className="flex items-center space-x-3">
                        <div className="text-sm">
                          <div className="font-medium">{photo.file.name}</div>
                          <div className="text-gray-500">
                            {(photo.file.size / 1024 / 1024).toFixed(2)} MB
                            {photo.uploaded && <span className="text-green-600 ml-2">✓ Uploaded</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeAnimalPhoto(index)}
                        className="text-red-600 hover:text-red-800"
                        disabled={isSubmitting}
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Another Photo */}
              <FileUpload
                label="Add animal photo"
                onFileSelect={handleAnimalPhotoSelect}
                onUploadComplete={handleAnimalPhotoUploadComplete(animalPhotos.length)}
                acceptedTypes=".jpg,.jpeg,.png"
                maxSizeMB={10}
                required={false}
              />
            </div>

            {/* Skip Upload Option */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
              <div className="flex items-start">
                <div className="flex items-center h-5">
                  <input
                    id="skip-uploads"
                    name="skip-uploads"
                    type="checkbox"
                    checked={skipUploads}
                    onChange={(e) => setSkipUploads(e.target.checked)}
                    className="focus:ring-yellow-500 h-4 w-4 text-yellow-600 border-gray-300 rounded"
                  />
                </div>
                <div className="ml-3">
                  <label htmlFor="skip-uploads" className="text-sm font-medium text-yellow-800">
                    I'll upload documents later
                  </label>
                  <p className="text-sm text-yellow-700 mt-1">
                    You can submit your application now and upload documents later. However, your application status will show "Evidence Pending" until documents are provided.
                  </p>
                </div>
              </div>
            </div>

            {/* Security Notice */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex">
                <svg className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 1L3 4v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V4l-7-3z" clipRule="evenodd" />
                </svg>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-green-800">
                    Secure Document Verification
                  </h3>
                  <div className="text-sm text-green-700 mt-1">
                    Each document is assigned a unique fingerprint (hash) that ensures its integrity throughout the process. This fingerprint is displayed above and will be verified when your application is reviewed.
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-6 border-t border-gray-200">
              <Link href="/apply/veterinarian">
                <Button variant="outline" type="button">
                  <svg className="mr-2 -ml-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Back
                </Button>
              </Link>

              <Button
                type="submit"
                disabled={!isFormValid() || isSubmitting}
                loading={isSubmitting}
              >
                Continue to Review
                <svg className="ml-2 -mr-1 w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 111.414-1.414L14.414 11H3a1 1 0 110-2h11.414l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </Button>
            </div>
          </form>

          {/* Progress Indicator */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Step 5 of 6</span>
              <span>Your uploads are saved automatically</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
