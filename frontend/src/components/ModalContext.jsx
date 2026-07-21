import React, { createContext, useContext, useState, useCallback } from 'react';

const ModalContext = createContext({ openCount: 0, openModal: () => {}, closeModal: () => {} });

export const ModalProvider = ({ children }) => {
  // Use a counter so stacked modals don't prematurely unhide the dock
  const [openCount, setOpenCount] = useState(0);

  const openModal = useCallback(() => setOpenCount((n) => n + 1), []);
  const closeModal = useCallback(() => setOpenCount((n) => Math.max(0, n - 1)), []);

  return (
    <ModalContext.Provider value={{ openCount, openModal, closeModal }}>
      {children}
    </ModalContext.Provider>
  );
};

/** Returns { isModalOpen, openModal, closeModal } */
export const useModalOverlay = () => {
  const { openCount, openModal, closeModal } = useContext(ModalContext);
  return { isModalOpen: openCount > 0, openModal, closeModal };
};

export default ModalContext;
